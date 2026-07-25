//! Process-level CEF lifecycle: subprocess entry point, browser-process
//! initialization, teardown, and the user-facing on/off preference.

use cef::{args::Args, *};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::browser::{close_browser, on_cef_ui};

#[cfg(target_os = "linux")]
#[link(name = "X11")]
extern "C" {
    fn XInitThreads() -> ::std::os::raw::c_int;
}

const CEF_CACHE_DIR: &str = "com.tslater.polyui/cef";
const CEF_ENABLED_FILE: &str = "com.tslater.polyui/cef-enabled";
const CEF_LOCALE: &str = "en-US";
/// Keep Chromium's HTTP cache bounded; page storage/cookies are separate.
const CEF_DISK_CACHE_BYTES: &str = "67108864";

/// Set once `initialize` succeeds, so `shutdown` cannot run against an
/// uninitialized CEF (which aborts inside Chromium) and cannot run twice.
static INITIALIZED: AtomicBool = AtomicBool::new(false);

pub(super) fn is_initialized() -> bool {
    INITIALIZED.load(Ordering::SeqCst)
}

fn browser_switches() -> [&'static str; 2] {
    ["disable-gpu", "disable-gpu-compositing"]
}

fn browser_switch_values() -> [(&'static str, &'static str); 2] {
    [
        ("disk-cache-size", CEF_DISK_CACHE_BYTES),
        // Chromium defaults to GTK4, but we already have GTK3 loaded via
        // webkit2gtk/Tauri. Both in one process aborts in GTK's CSS code.
        // Ignored on non-Linux.
        ("gtk-version", "3"),
    ]
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
/// processes, distinguishing them by `--type=` on the command line. In those
/// processes this call blocks until that subprocess is done and returns its
/// exit code; in the browser process it returns `None` immediately and startup
/// continues into Tauri.
///
/// Must be called before anything else in `main` — see module threading
/// invariants.
pub fn execute_subprocess() -> Option<i32> {
    initialize_api_version();
    let args = Args::new();
    // SAFETY: the third argument is Windows sandbox info; CEF requires null on
    // every other platform. `None` for the app: the spike registers no custom
    // process handlers, so the subprocesses need no Rust-side callbacks.
    let code = cef::execute_process(Some(args.as_main_args()), None, std::ptr::null_mut());
    // >= 0 means "this process was a CEF subprocess and has finished".
    // -1 means "this is the browser process, carry on".
    (code >= 0).then_some(code)
}

fn initialize_api_version() {
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
}

/// Initializes CEF in the browser process. Main thread only.
pub fn init() -> Result<(), String> {
    prepare_windowing_threads()?;
    let args = Args::new();
    let cache_path = dirs::cache_dir()
        .ok_or_else(|| "OS cache directory is unavailable.".to_string())?
        .join(CEF_CACHE_DIR);
    std::fs::create_dir_all(&cache_path).map_err(|error| error.to_string())?;
    let settings = cef_settings(&cache_path);
    let mut app = OsrApp::new();

    // SAFETY: null sandbox info, as required on Linux. Called on the main
    // application thread before GTK; CEF creates its separate UI thread.
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

/// X11 and GDK have to be told the process is multi-threaded before anything
/// touches them. Windows has no equivalent — the message loop CEF starts is
/// already thread-safe.
#[cfg(target_os = "linux")]
fn prepare_windowing_threads() -> Result<(), String> {
    // SAFETY: this is the first Xlib/GDK work in the process. CEF's Linux
    // multi-threaded loop requires both calls before CEF and GTK initialize.
    if unsafe { XInitThreads() } == 0 {
        return Err("XInitThreads failed before CEF initialization.".to_string());
    }
    unsafe { gtk::gdk::ffi::gdk_threads_init() };
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
///
/// This must run before the process exits, otherwise CEF's child processes are
/// orphaned and survive as zombies. `lib.rs` hard-exits on `ExitRequested`
/// (Tauri teardown deadlocks on Linux), so this is called from there rather
/// than relying on any Drop impl, which a `process::exit` would skip.
pub fn shutdown() {
    if is_initialized() {
        let _ = on_cef_ui(close_browser);
        cef::shutdown();
        INITIALIZED.store(false, Ordering::SeqCst);
    }
}

fn enabled_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|path| path.join(CEF_ENABLED_FILE))
        .ok_or_else(|| "OS config directory is unavailable.".to_string())
}

/// Whether the next launch should bring CEF up. Read by `main` before any
/// CEF or Tauri work happens, so it is a file rather than app state.
pub fn enabled_on_next_start() -> bool {
    enabled_path().is_ok_and(|path| path.is_file())
}

pub(super) fn set_enabled(enabled: bool) -> Result<(), String> {
    set_enabled_at(&enabled_path()?, enabled)
}

fn set_enabled_at(path: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        let parent = path
            .parent()
            .ok_or_else(|| "CEF preference path has no parent directory.".to_string())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        return std::fs::write(path, b"enabled").map_err(|error| error.to_string());
    }

    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
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
        assert_eq!(settings.root_cache_path.to_string(), "/tmp/polyui-cef-test");
        assert_eq!(settings.locale.to_string(), "en-US");
    }

    #[test]
    fn cpu_osr_disables_unneeded_gpu_processes() {
        assert_eq!(
            browser_switches(),
            ["disable-gpu", "disable-gpu-compositing"]
        );
        assert_eq!(
            browser_switch_values(),
            [("disk-cache-size", "67108864"), ("gtk-version", "3")]
        );
    }

    #[test]
    fn cef_preference_can_be_enabled_and_disabled() {
        let path = std::env::temp_dir().join(format!("polyui-cef-enabled-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);

        set_enabled_at(&path, true).expect("enable CEF preference");
        assert!(path.is_file());

        set_enabled_at(&path, false).expect("disable CEF preference");
        assert!(!path.exists());
    }

    #[test]
    fn cef_selects_generated_api_version_before_callbacks() {
        initialize_api_version();

        assert_eq!(cef::api_version(), cef::sys::CEF_API_VERSION_LAST);
    }
}
