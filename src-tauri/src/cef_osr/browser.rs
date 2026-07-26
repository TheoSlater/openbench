//! The single OSR browser instance, plus the hop onto CEF's UI thread.
//!
//! CEF owns the browser from its own UI thread, so the browser handle lives in
//! a thread-local there and every accessor goes through [`on_cef_ui`].

use cef::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::handlers::{NavState, OsrClient, OsrDisplayHandler, OsrLoadHandler, OsrRenderHandler};
use super::lifecycle::is_initialized;

const TARGET_FRAME_RATE: i32 = 60;
/// Generous: creating a browser pulls up Chromium's network/render machinery.
/// Only meant to catch a UI thread that is never coming back.
const CEF_UI_TASK_TIMEOUT: Duration = Duration::from_secs(10);

/// Viewport geometry shared between the browser and its render handler: CEF
/// pulls the current values from the handler whenever it needs to lay out or
/// paint, so a resize only has to write here and poke the host.
#[derive(Clone)]
pub(super) struct ViewState {
    width: Rc<Cell<i32>>,
    height: Rc<Cell<i32>>,
    scale_factor: Rc<Cell<f32>>,
    /// Forces the next paint to be sent whole. A resize invalidates the
    /// canvas, so dirty rects from the old geometry cannot be trusted.
    full_frame_pending: Rc<Cell<bool>>,
}

impl ViewState {
    fn new(width: i32, height: i32, scale_factor: f32) -> Self {
        Self {
            width: Rc::new(Cell::new(width)),
            height: Rc::new(Cell::new(height)),
            scale_factor: Rc::new(Cell::new(scale_factor)),
            full_frame_pending: Rc::new(Cell::new(true)),
        }
    }

    pub(super) fn size(&self) -> (i32, i32) {
        (self.width.get(), self.height.get())
    }

    pub(super) fn scale_factor(&self) -> f32 {
        self.scale_factor.get()
    }

    /// Consumes the pending flag; true means "send the whole surface".
    pub(super) fn take_full_frame_pending(&self) -> bool {
        self.full_frame_pending.replace(false)
    }

    fn resize(&self, width: i32, height: i32, scale_factor: f32) {
        self.width.set(width);
        self.height.set(height);
        self.scale_factor.set(scale_factor);
        self.full_frame_pending.set(true);
    }
}

struct BrowserState {
    browser: Browser,
    view: ViewState,
}

thread_local! {
    static BROWSER: RefCell<Option<BrowserState>> = const { RefCell::new(None) };
}

type CefUiJob = Box<dyn FnOnce() + Send + 'static>;

cef::wrap_task! {
    struct CefUiTask {
        job: Arc<Mutex<Option<CefUiJob>>>,
    }

    impl Task {
        fn execute(&self) {
            let job = match self.job.lock() {
                Ok(mut slot) => slot.take(),
                Err(poisoned) => poisoned.into_inner().take(),
            };
            if let Some(job) = job {
                job();
            }
        }
    }
}

/// Runs `task` on CEF's UI thread and waits for its result. Already on that
/// thread (a CEF callback), it runs inline.
pub(super) fn on_cef_ui<T: Send + 'static>(
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    // Without this, a failed startup init leaves every command posting into a
    // CEF that does not exist, and the UI only sees a generic rejection.
    if !is_initialized() {
        return Err("CEF is not initialized — startup init failed, see startup.log.".to_string());
    }
    if cef::currently_on(ThreadId::UI) == 1 {
        return Ok(task());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let job = move || {
        let _ = tx.send(task());
    };
    let mut task = CefUiTask::new(Arc::new(Mutex::new(Some(Box::new(job)))));
    if cef::post_task(ThreadId::UI, Some(&mut task)) != 1 {
        return Err("CEF UI thread rejected the viewport task.".to_string());
    }
    // Bounded: a wedged CEF UI thread would otherwise block this Tauri command
    // forever, and the frontend has no way to tell that apart from a slow page —
    // it just spins its loader with no error, indefinitely.
    rx.recv_timeout(CEF_UI_TASK_TIMEOUT)
        .map_err(|error| match error {
            RecvTimeoutError::Timeout => format!(
                "CEF UI thread did not respond within {}s.",
                CEF_UI_TASK_TIMEOUT.as_secs()
            ),
            RecvTimeoutError::Disconnected => {
                "CEF viewport task was dropped by the UI thread.".to_string()
            }
        })
}

/// Runs `f` against the open browser's host. UI thread only.
pub(super) fn with_host<T>(f: impl FnOnce(&BrowserHost) -> T) -> Result<T, String> {
    BROWSER.with(|cell| {
        let borrow = cell.borrow();
        let state = borrow
            .as_ref()
            .ok_or_else(|| "CEF viewport is not open.".to_string())?;
        let host = state
            .browser
            .host()
            .ok_or_else(|| "CEF browser host is unavailable.".to_string())?;
        Ok(f(&host))
    })
}

/// Replaces any open browser with a new one at `url`. UI thread only.
pub(super) fn open_browser(
    url: String,
    width: i32,
    height: i32,
    scale_factor: f32,
    on_frame: Channel<InvokeResponseBody>,
    on_cursor: Channel<String>,
    on_address: Channel<String>,
    on_nav_state: Channel<NavState>,
) -> Result<(), String> {
    if !is_initialized() {
        return Err("CEF is not initialized.".to_string());
    }
    close_browser();

    let view = ViewState::new(width, height, scale_factor);
    let mut client = OsrClient::new(
        OsrRenderHandler::new(view.clone(), on_frame),
        OsrDisplayHandler::new(on_cursor, on_address),
        OsrLoadHandler::new(on_nav_state),
    );
    let window_info = WindowInfo::default().set_as_windowless(Default::default());
    let browser_settings = BrowserSettings {
        windowless_frame_rate: TARGET_FRAME_RATE,
        background_color: 0xFFFF_FFFF,
        ..Default::default()
    };
    let browser = cef::browser_host_create_browser_sync(
        Some(&window_info),
        Some(&mut client),
        Some(&url.as_str().into()),
        Some(&browser_settings),
        None,
        None,
    )
    .ok_or_else(|| "CEF failed to create the OSR browser.".to_string())?;
    BROWSER.with(|cell| *cell.borrow_mut() = Some(BrowserState { browser, view }));
    Ok(())
}

/// UI thread only.
pub(super) fn resize_browser(width: i32, height: i32, scale_factor: f32) {
    BROWSER.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            state.view.resize(width, height, scale_factor);
            if let Some(host) = state.browser.host() {
                host.notify_screen_info_changed();
                host.was_resized();
            }
        }
    });
}

/// Runs `f` against the open browser, doing nothing if none is open. UI thread
/// only. Mirrors [`with_host`], for the calls that live on `Browser` itself.
fn with_browser(f: impl FnOnce(&Browser)) {
    BROWSER.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            f(&state.browser);
        }
    });
}

/// UI thread only.
pub(super) fn reload_browser() {
    with_browser(|browser| browser.reload());
}

/// Navigates the open browser, pushing a real Chromium history entry.
///
/// This is what makes [`go_back_browser`] work: the app deliberately does not
/// keep its own history list, because Chromium's is the only one that sees
/// in-page navigations. UI thread only.
pub(super) fn navigate_browser(url: String) {
    with_browser(|browser| {
        if let Some(frame) = browser.main_frame() {
            let url: CefString = url.as_str().into();
            frame.load_url(Some(&url));
        }
    });
}

/// UI thread only.
pub(super) fn go_back_browser() {
    with_browser(|browser| browser.go_back());
}

/// UI thread only.
pub(super) fn go_forward_browser() {
    with_browser(|browser| browser.go_forward());
}

/// UI thread only.
pub(super) fn close_browser() {
    BROWSER.with(|cell| {
        if let Some(state) = cell.borrow_mut().take() {
            if let Some(host) = state.browser.host() {
                host.close_browser(1);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_tasks_fail_fast_when_cef_never_initialized() {
        // INITIALIZED is false in tests, matching a prod run whose startup init
        // failed: the command must return, not leave the UI loading forever.
        let error = on_cef_ui(|| ()).expect_err("uninitialized CEF must be an error");

        assert!(error.contains("startup.log"), "unexpected error: {error}");
    }
}
