//! Out-of-process CEF viewport helper.
//!
//! Exists so that `polyui` links no CEF at all: libcef is 261MB, the browser is
//! opt-in and off by default, and linking it into the app made every user
//! download Chromium for a feature most never enable. This binary and the CEF
//! runtime ship as a pack that is downloaded on demand.
//!
//! Protocol: see [`protocol`]. Commands arrive as JSON lines on stdin, frames
//! and events leave as framed binary messages on the rescued stdout fd.

mod browser;
mod frame;
mod handlers;
mod input;
mod lifecycle;
mod protocol;

use std::io::{BufRead, Write};

use protocol::{Command, Sink};

fn main() {
    // Must happen before execute_subprocess: CEF re-executes this binary for
    // its render/GPU/zygote children and they inherit our descriptors, so fd 1
    // has to stop being the frame stream before any of them exist.
    let frames = rescue_stdout();

    // Must be the first real work in main. CEF forks a zygote on Linux, and
    // forking a process that already has threads is undefined behaviour.
    if let Some(code) = lifecycle::execute_subprocess() {
        std::process::exit(code);
    }

    let sink = Sink::new(frames);

    if let Err(error) = lifecycle::init() {
        sink.error(0, &error);
        std::process::exit(1);
    }

    run_command_loop(&sink);

    lifecycle::shutdown();
}

/// Moves the frame stream off fd 1 and points fd 1 at stderr.
///
/// Chromium writes to stdout from several processes and pays no attention to
/// what we are using it for. Without this, one stray line corrupts the binary
/// frame stream and the main process desynchronises permanently.
#[cfg(unix)]
fn rescue_stdout() -> Box<dyn Write + Send> {
    use std::os::fd::FromRawFd;

    // SAFETY: fd 1 and 2 are open at process start. `dup` gives us a private
    // copy to own, and `dup2` then makes anything written to fd 1 (by us, by
    // Chromium, or by any child) land on stderr instead.
    unsafe {
        let saved = libc::dup(1);
        if saved < 0 {
            // Nothing to write frames to; fall through to a real stdout so the
            // caller at least sees the error message.
            return Box::new(std::io::stdout());
        }
        libc::dup2(2, 1);
        Box::new(std::fs::File::from_raw_fd(saved))
    }
}

#[cfg(windows)]
fn rescue_stdout() -> Box<dyn Write + Send> {
    // Untested: no Windows machine in this session. Same shape as the unix
    // path — keep the real stdout handle for frames, then point the process
    // stdout handle at stderr so inherited children cannot write to ours.
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::System::Console::{
        GetStdHandle, SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };

    // SAFETY: both handles are valid at process start.
    unsafe {
        let out = GetStdHandle(STD_OUTPUT_HANDLE);
        let err = GetStdHandle(STD_ERROR_HANDLE);
        SetStdHandle(STD_OUTPUT_HANDLE, err);
        Box::new(std::fs::File::from_raw_handle(out as _))
    }
}

/// Reads commands until stdin closes. EOF means the main process is gone, which
/// is the helper's cue to shut CEF down and exit rather than linger as an
/// orphan holding a Chromium tree.
fn run_command_loop(sink: &Sink) {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Command>(&line) {
            Ok(Command::Shutdown) => break,
            Ok(command) => dispatch(sink, command),
            Err(error) => sink.error(0, &format!("bad viewport command: {error}")),
        }
    }
}

fn dispatch(sink: &Sink, command: Command) {
    let sink_for_error = sink.clone();
    let (id, result) = match command {
        Command::Open {
            id,
            url,
            width,
            height,
            scale_factor,
        } => {
            let sink = sink.clone();
            (
                id,
                browser::on_cef_ui(move || {
                    browser::open_browser(id, url, width, height, scale_factor, sink)
                })
                .and_then(|inner| inner),
            )
        }
        Command::Resize {
            id,
            width,
            height,
            scale_factor,
        } => (
            id,
            browser::on_cef_ui(move || browser::resize_browser(id, width, height, scale_factor)).and_then(|inner| inner),
        ),
        Command::Navigate { id, url } => (
            id,
            browser::on_cef_ui(move || browser::navigate_browser(id, url)).and_then(|inner| inner),
        ),
        Command::Back { id } => (
            id,
            browser::on_cef_ui(move || browser::go_back(id)).and_then(|inner| inner),
        ),
        Command::Forward { id } => (
            id,
            browser::on_cef_ui(move || browser::go_forward(id)).and_then(|inner| inner),
        ),
        Command::Reload { id } => (
            id,
            browser::on_cef_ui(move || browser::reload_browser(id)).and_then(|inner| inner),
        ),
        // Closing an already-closed browser is not an error: the app can race a
        // tab close against an in-flight command.
        Command::Close { id } => (id, browser::on_cef_ui(move || browser::close_browser(id))),
        Command::Input { id, events } => (
            id,
            browser::on_cef_ui(move || input::dispatch_input(id, events)).and_then(|inner| inner),
        ),
        // Handled by the loop so it can stop reading.
        Command::Shutdown => return,
    };
    if let Err(error) = result {
        sink_for_error.error(id, &error);
    }
}
