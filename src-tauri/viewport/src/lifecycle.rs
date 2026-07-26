//! Process-level CEF lifecycle: subprocess entry point, browser-process
//! initialization and teardown.
//!
//! Compared with the in-process version this replaces, three hacks are gone
//! because nothing else lives in this process:
//!
//! - no `gtk-version=3` switch. That existed because Tauri had already loaded
//!   GTK3 via webkit2gtk and Chromium defaults to GTK4; both in one process
//!   aborts inside GTK's CSS code. Chromium gets its own default here.
//! - no `hide-bundled-sqlite.map` version script. That existed because polyui's
//!   sqlx-bundled SQLite interposed over the system libsqlite3 that CEF's NSS
//!   init drives. This binary links no sqlx.
//! - no `gdk_threads_init`. There is no GTK main loop here to coordinate with.
//!
//! `XInitThreads` stays: CEF's multi-threaded message loop still talks to X11
//! from more than one thread, and Xlib requires the call before any other Xlib
//! work regardless of who else is in the process.

use cef::{args::Args, *};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::browser::{close_all_browsers, on_cef_ui};

#[cfg(target_os = "linux")]
#[link(name = "X11")]
extern "C" {
    fn XInitThreads() -> ::std::os::raw::c_int;
}

const CEF_CACHE_DIR: &str = "com.tslater.polyui/cef";
const CEF_LOCALE: &str = "en-US";
/// Keep Chromium's HTTP cache bounded; page storage/cookies are separate.
const CEF_DISK_CACHE_BYTES: &str = "67108864";

/// Set once `initialize` succeeds, so `shutdown` cannot run against an
/// uninitialized CEF (which aborts inside Chromium) and cannot run twice.
static INITIALIZED: AtomicBool = AtomicBool::new(false);

pub fn is_initialized() -> bool {
    INITIALIZED.load(Ordering::SeqCst)
}

fn browser_switches() -> [&'static str; 2] {
    ["disable-gpu", "disable-gpu-compositing"]
}

fn browser_switch_values() -> [(&'static str, &'static str); 1] {
    [("disk-cache-size", CEF_DISK_CACHE_BYTES)]
}

cef::wrap_app! {
    struct OsrApp;

    impl App {
        fn on_before_command_line_processing(
            &self,
            _process_type: Option<&CefString>,
            command_line: Option<&mut CommandLine>,
        ) {
            if let Some(command_line) = command_line {
                for switch in browser_switches() {
                    let switch: CefString = switch.into();
                    command_line.append_switch(Some(&switch));
                }
                for (name, value) in browser_switch_values() {
                    let name: CefString = name.into();
                    let value: CefString = value.into();
                    command_line.append_switch_with_value(Some(&name), Some(&value));
                }
            }
        }
    }
}

/// Runs the CEF subprocess entry point.
///
/// CEF re-executes *this same binary* for its render/GPU/zygote/utility
/// processes, distinguishing them by `--type=`. In those processes this call
/// blocks until the subprocess is done and returns its exit code; in the
/// browser process it returns `None` immediately.
///
/// Must be called before anything else in `main` — CEF forks a zygote on Linux
/// and forking a process that already has threads is undefined behaviour.
pub fn execute_subprocess() -> Option<i32> {
    initialize_api_version();
    let args = Args::new();
    // SAFETY: the third argument is Windows sandbox info; CEF requires null on
    // every other platform. `None` for the app: the subprocesses register no
    // Rust-side callbacks.
    let code = cef::execute_process(Some(args.as_main_args()), None, std::ptr::null_mut());
    // >= 0 means "this process was a CEF subprocess and has finished".
    // -1 means "this is the browser process, carry on".
    (code >= 0).then_some(code)
}

fn initialize_api_version() {
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
}

/// Chromium enforces a process singleton per user-data-dir: a second process
/// pointed at a live profile hands its command line to the first and exits with
/// code 24 rather than initializing. The override exists so a helper can be run
/// against a scratch profile (smoke tests, a second dev instance) without
/// colliding with an app that is already running.
fn cache_path() -> Result<std::path::PathBuf, String> {
    if let Some(path) = std::env::var_os("POLYUI_VIEWPORT_CACHE_DIR") {
        return Ok(std::path::PathBuf::from(path));
    }
    Ok(dirs::cache_dir()
        .ok_or_else(|| "OS cache directory is unavailable.".to_string())?
        .join(CEF_CACHE_DIR))
}

/// Initializes CEF in the browser process. Main thread only.
pub fn init() -> Result<(), String> {
    prepare_windowing_threads()?;
    let args = Args::new();
    let cache_path = cache_path()?;
    std::fs::create_dir_all(&cache_path).map_err(|error| error.to_string())?;
    let settings = cef_settings(&cache_path);
    let mut app = OsrApp::new();

    // SAFETY: null sandbox info, as required on Linux. Called on the main
    // thread before anything else; CEF creates its separate UI thread.
    let ok = cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if ok != 1 {
        return Err(format!(
            "cef::initialize failed (exit code {})",
            cef::get_exit_code()
        ));
    }
    INITIALIZED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Xlib requires this before any other Xlib call in a multi-threaded process.
#[cfg(target_os = "linux")]
fn prepare_windowing_threads() -> Result<(), String> {
    // SAFETY: this is the first Xlib work in the process.
    if unsafe { XInitThreads() } == 0 {
        return Err("XInitThreads failed before CEF initialization.".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn prepare_windowing_threads() -> Result<(), String> {
    Ok(())
}

fn cef_settings(cache_path: &Path) -> Settings {
    let cache_path: CefString = cache_path.to_string_lossy().as_ref().into();
    Settings {
        no_sandbox: 1,
        // Required for any windowless (OSR) browser to be creatable at all.
        windowless_rendering_enabled: 1,
        multi_threaded_message_loop: 1,
        external_message_pump: 0,
        cache_path: cache_path.clone(),
        root_cache_path: cache_path,
        locale: CEF_LOCALE.into(),
        ..Default::default()
    }
}

/// Tears CEF down. Main thread only, and only from the exit path.
pub fn shutdown() {
    if is_initialized() {
        let _ = on_cef_ui(close_all_browsers);
        cef::shutdown();
        INITIALIZED.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cef_uses_its_supported_linux_ui_thread() {
        let settings = cef_settings(Path::new("/tmp/polyui-cef-test"));

        assert_eq!(settings.external_message_pump, 0);
        assert_eq!(settings.multi_threaded_message_loop, 1);
        assert_eq!(settings.cache_path.to_string(), "/tmp/polyui-cef-test");
        assert_eq!(settings.locale.to_string(), "en-US");
    }

    #[test]
    fn cpu_osr_disables_unneeded_gpu_processes() {
        assert_eq!(browser_switches(), ["disable-gpu", "disable-gpu-compositing"]);
        // gtk-version is deliberately absent: no GTK3 webkit in this process.
        assert_eq!(browser_switch_values(), [("disk-cache-size", "67108864")]);
    }

    #[test]
    fn cef_selects_generated_api_version_before_callbacks() {
        initialize_api_version();

        assert_eq!(cef::api_version(), cef::sys::CEF_API_VERSION_LAST);
    }
}
