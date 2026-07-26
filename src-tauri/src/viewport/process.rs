//! Supervises the `polyui-viewport` helper process.
//!
//! The helper owns CEF; this side owns its lifetime and demultiplexes its
//! output onto the per-browser Tauri channels the frontend opened. Nothing
//! here links CEF, and nothing here parses a frame packet — frame payloads are
//! forwarded byte-for-byte into the frontend channel.

use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use tauri::ipc::{Channel, InvokeResponseBody};

/// Names one browser. Allocated by the frontend, one per mounted canvas.
pub type BrowserId = u32;

const TAG_FRAME: u8 = 0;
const TAG_CURSOR: u8 = 1;
const TAG_ADDRESS: u8 = 2;
const TAG_NAV_STATE: u8 = 3;
const TAG_ERROR: u8 = 4;

/// Where the frontend's messages for one browser go.
#[derive(Clone)]
pub struct BrowserChannels {
    pub on_frame: Channel<InvokeResponseBody>,
    pub on_cursor: Channel<String>,
    pub on_address: Channel<String>,
    pub on_nav_state: Channel<serde_json::Value>,
    pub on_error: Channel<String>,
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
}

static HELPER: OnceLock<Mutex<Option<Helper>>> = OnceLock::new();
static CHANNELS: OnceLock<Mutex<HashMap<BrowserId, BrowserChannels>>> = OnceLock::new();

fn helper_slot() -> &'static Mutex<Option<Helper>> {
    HELPER.get_or_init(|| Mutex::new(None))
}

fn channels() -> &'static Mutex<HashMap<BrowserId, BrowserChannels>> {
    CHANNELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Locates the helper binary.
///
/// Stage 4 replaces the data-dir branch with a verified, downloaded pack; until
/// then the dev-tree fallback is what makes the feature usable at all. libcef
/// must sit next to whichever copy is chosen — the helper's rpath is `$ORIGIN`.
pub fn helper_path() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "polyui-viewport.exe"
    } else {
        "polyui-viewport"
    };

    if let Some(path) = std::env::var_os("POLYUI_VIEWPORT_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(data) = dirs::data_dir() {
        let path = data
            .join("com.tslater.polyui/viewport")
            .join(super::CEF_VERSION)
            .join(name);
        if path.is_file() {
            return Some(path);
        }
    }

    // Dev tree: cargo puts the helper in the same target dir as polyui itself.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let path = dir.join(name);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

pub fn is_installed() -> bool {
    helper_path().is_some()
}

/// Starts the helper if it is not already running. Idempotent.
fn ensure_started(slot: &mut Option<Helper>) -> Result<(), String> {
    if let Some(helper) = slot.as_mut() {
        // `try_wait` reaps a helper that died since the last command, so the
        // next call respawns instead of writing into a broken pipe.
        match helper.child.try_wait() {
            Ok(None) => return Ok(()),
            _ => {
                *slot = None;
            }
        }
    }

    let path = helper_path().ok_or_else(|| {
        "The browser runtime is not installed. Enable the Chromium browser in Settings → Advanced."
            .to_string()
    })?;

    let mut command = Command::new(&path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    kill_child_with_parent(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start the browser runtime: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Browser runtime stdin was unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Browser runtime stdout was unavailable.".to_string())?;

    std::thread::Builder::new()
        .name("viewport-reader".into())
        .spawn(move || read_messages(stdout))
        .map_err(|error| format!("Failed to start the viewport reader: {error}"))?;

    *slot = Some(Helper { child, stdin });
    Ok(())
}

/// The app hard-exits on quit (Tauri teardown deadlocks on Linux), which skips
/// every destructor. Without this, a crashed or force-killed app would orphan a
/// whole Chromium process tree.
#[cfg(target_os = "linux")]
fn kill_child_with_parent(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: pre_exec runs in the forked child before exec. prctl is
    // async-signal-safe and touches no allocator state.
    unsafe {
        command.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn kill_child_with_parent(_command: &mut Command) {}

/// Splits the helper's byte stream into messages, calling `on_message` for
/// each. Stops at EOF or on a malformed length.
///
/// Separate from the dispatch below so the framing — the half that must agree
/// exactly with `protocol.rs` in the helper, and the half that desynchronises
/// permanently if it is wrong — can be tested without a process or a Channel.
fn read_frames(read: impl Read, mut on_message: impl FnMut(u8, BrowserId, &[u8])) {
    let mut reader = BufReader::new(read);
    let mut header = [0u8; 4];
    loop {
        if reader.read_exact(&mut header).is_err() {
            break;
        }
        let length = u32::from_le_bytes(header) as usize;
        if length < 5 {
            break;
        }
        let mut body = vec![0u8; length];
        if reader.read_exact(&mut body).is_err() {
            break;
        }
        let id = u32::from_le_bytes([body[1], body[2], body[3], body[4]]);
        on_message(body[0], id, &body[5..]);
    }
}

/// Reads framed messages until the helper exits. EOF is the crash signal.
fn read_messages(stdout: std::process::ChildStdout) {
    read_frames(stdout, |tag, id, payload| {
        let channel = channels().lock().ok().and_then(|map| map.get(&id).cloned());
        let Some(channel) = channel else { return };

        match tag {
            // Forwarded verbatim: this side never parses a frame.
            TAG_FRAME => {
                let _ = channel
                    .on_frame
                    .send(InvokeResponseBody::Raw(payload.to_vec()));
            }
            TAG_CURSOR => {
                let _ = channel.on_cursor.send(String::from_utf8_lossy(payload).into());
            }
            TAG_ADDRESS => {
                let _ = channel
                    .on_address
                    .send(String::from_utf8_lossy(payload).into());
            }
            TAG_NAV_STATE => {
                if let Ok(value) = serde_json::from_slice(payload) {
                    let _ = channel.on_nav_state.send(value);
                }
            }
            TAG_ERROR => {
                let _ = channel.on_error.send(String::from_utf8_lossy(payload).into());
            }
            _ => {}
        }
    });
    on_helper_exit();
}

/// Tells every open browser the runtime is gone, then clears the slot so the
/// next open respawns. Without this the frontend would sit on its loading
/// spinner with no idea the process died.
fn on_helper_exit() {
    if let Ok(mut slot) = helper_slot().lock() {
        *slot = None;
    }
    let open = channels()
        .lock()
        .map(|mut map| map.drain().collect::<Vec<_>>())
        .unwrap_or_default();
    for (_, channel) in open {
        let _ = channel
            .on_error
            .send("The browser runtime stopped unexpectedly.".to_string());
    }
}

/// Sends one command. Starts the helper if needed.
///
/// ponytail: the write happens under the helper lock, so a helper that stops
/// reading stdin would block every later command behind it. Commands are small
/// and the helper's reader loop does nothing but parse and post, so the pipe
/// buffer absorbs them; if that ever stops being true, move the writes onto a
/// queue with a dedicated writer thread.
pub fn send(command: serde_json::Value) -> Result<(), String> {
    let mut slot = helper_slot()
        .lock()
        .map_err(|_| "Viewport runtime lock poisoned.".to_string())?;
    ensure_started(&mut slot)?;
    let helper = slot
        .as_mut()
        .ok_or_else(|| "Browser runtime is not running.".to_string())?;
    let mut line = serde_json::to_vec(&command)
        .map_err(|error| format!("Failed to encode viewport command: {error}"))?;
    line.push(b'\n');
    helper
        .stdin
        .write_all(&line)
        .and_then(|()| helper.stdin.flush())
        .map_err(|error| {
            // A broken pipe means the helper died between spawn and write.
            *slot = None;
            format!("Browser runtime is not responding: {error}")
        })
}

pub fn register(id: BrowserId, channel: BrowserChannels) {
    if let Ok(mut map) = channels().lock() {
        map.insert(id, channel);
    }
}

pub fn unregister(id: BrowserId) {
    if let Ok(mut map) = channels().lock() {
        map.remove(&id);
    }
}

/// Stops the helper. Called from the app's exit path, before `process::exit`.
pub fn shutdown() {
    let Ok(mut slot) = helper_slot().lock() else {
        return;
    };
    let Some(mut helper) = slot.take() else {
        return;
    };
    // Ask politely, then insist. CEF needs its own shutdown to run or it leaves
    // child processes behind, but a wedged helper must not block app exit.
    let _ = helper.stdin.write_all(b"{\"cmd\":\"shutdown\"}\n");
    let _ = helper.stdin.flush();
    drop(helper.stdin);
    for _ in 0..20 {
        match helper.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = helper.child.kill();
    let _ = helper.child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a message exactly as the helper's `Sink::send` does.
    fn message(tag: u8, id: BrowserId, payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 5) as u32).to_le_bytes().to_vec();
        out.push(tag);
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(payload);
        out
    }

    fn collect(bytes: &[u8]) -> Vec<(u8, BrowserId, Vec<u8>)> {
        let mut seen = Vec::new();
        read_frames(bytes, |tag, id, payload| {
            seen.push((tag, id, payload.to_vec()))
        });
        seen
    }

    #[test]
    fn splits_a_concatenated_stream_into_messages() {
        // The pipe delivers arbitrary chunks, so several messages routinely
        // arrive in one read. Getting this wrong desynchronises permanently.
        let mut stream = message(TAG_FRAME, 1, b"pixels");
        stream.extend(message(TAG_ADDRESS, 2, b"https://example.com"));
        stream.extend(message(TAG_NAV_STATE, 1, b"{}"));

        let seen = collect(&stream);

        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0], (TAG_FRAME, 1, b"pixels".to_vec()));
        assert_eq!(seen[1], (TAG_ADDRESS, 2, b"https://example.com".to_vec()));
        assert_eq!(seen[2], (TAG_NAV_STATE, 1, b"{}".to_vec()));
    }

    #[test]
    fn keeps_empty_payloads_and_distinguishes_browsers() {
        let mut stream = message(TAG_ERROR, 7, b"");
        stream.extend(message(TAG_FRAME, 4_000_000_000, b"x"));

        let seen = collect(&stream);

        assert_eq!(seen[0], (TAG_ERROR, 7, Vec::new()));
        assert_eq!(seen[1].1, 4_000_000_000);
    }

    #[test]
    fn stops_on_a_truncated_message_rather_than_inventing_one() {
        let full = message(TAG_FRAME, 1, b"abcdefgh");
        let truncated = &full[..full.len() - 3];

        assert!(collect(truncated).is_empty());
    }

    /// Drives the real helper binary through the real reader.
    ///
    /// The Node protocol check proves the helper's side of the wire; this
    /// proves ours against it, which is the half that would desynchronise
    /// silently. Skips when the helper is not built, so a CEF-less checkout
    /// still runs the suite.
    #[test]
    fn reads_real_frames_from_the_real_helper() {
        let Some(path) = helper_path() else {
            eprintln!("skipping: no polyui-viewport binary");
            return;
        };
        // Its own profile: Chromium's process singleton makes a second CEF on a
        // live user-data-dir hand off and exit instead of starting.
        let profile = std::env::temp_dir().join(format!("polyui-vp-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&profile);

        let mut child = Command::new(path)
            .env("POLYUI_VIEWPORT_CACHE_DIR", &profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn helper");
        let mut stdin = child.stdin.take().expect("stdin");
        stdin
            .write_all(
                b"{\"cmd\":\"open\",\"id\":42,\"url\":\"data:,\",\"width\":320,\"height\":240,\"scaleFactor\":1.0}\n",
            )
            .expect("write open");
        stdin.flush().expect("flush");

        let stdout = child.stdout.take().expect("stdout");
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            read_frames(stdout, |tag, id, payload| {
                let _ = tx.send((tag, id, payload.len()));
            });
        });

        // `data:,` is rejected by the helper's own validation upstream, so what
        // comes back is an error for browser 42 -- which still proves framing,
        // tagging and id routing across the real pipe.
        let mut seen = Vec::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                Ok(message) => {
                    seen.push(message);
                    break;
                }
                Err(_) => break,
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&profile);

        let (tag, id, _) = *seen.first().expect("helper sent no message");
        assert_eq!(id, 42, "message routed to the wrong browser");
        assert!(
            tag <= TAG_ERROR,
            "unknown tag {tag}: the two sides disagree on the wire format"
        );
    }

    #[test]
    fn stops_on_an_impossible_length() {
        // A length below the 5-byte tag+id floor means the stream is not what
        // we think it is; reading on would emit garbage frames.
        let stream = 2u32.to_le_bytes().to_vec();

        assert!(collect(&stream).is_empty());
    }
}
