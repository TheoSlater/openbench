//! The OSR browsers, plus the hop onto CEF's UI thread.
//!
//! CEF owns a browser from its own UI thread, so the handles live in a
//! thread-local map there and every accessor goes through [`on_cef_ui`].
//!
//! Unlike the in-process version this replaces, the map holds *many* browsers
//! keyed by [`BrowserId`]. One helper hosts every viewport tab: switching tabs
//! must not cost a ~579ms Chromium rebuild, and a tab has to keep its session
//! history while it is in the background.

use cef::*;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::handlers::{OsrClient, OsrDisplayHandler, OsrLoadHandler, OsrRenderHandler};
use crate::lifecycle::is_initialized;
use crate::protocol::{BrowserId, Sink};

const TARGET_FRAME_RATE: i32 = 60;
/// Generous: creating a browser pulls up Chromium's network/render machinery.
/// Only meant to catch a UI thread that is never coming back.
const CEF_UI_TASK_TIMEOUT: Duration = Duration::from_secs(10);

/// Viewport geometry shared between a browser and its render handler: CEF pulls
/// the current values from the handler whenever it needs to lay out or paint,
/// so a resize only has to write here and poke the host.
#[derive(Clone)]
pub struct ViewState {
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

    pub fn size(&self) -> (i32, i32) {
        (self.width.get(), self.height.get())
    }

    pub fn scale_factor(&self) -> f32 {
        self.scale_factor.get()
    }

    /// Consumes the pending flag; true means "send the whole surface".
    pub fn take_full_frame_pending(&self) -> bool {
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
    static BROWSERS: RefCell<HashMap<BrowserId, BrowserState>> =
        RefCell::new(HashMap::new());
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
pub fn on_cef_ui<T: Send + 'static>(
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    if !is_initialized() {
        return Err("CEF is not initialized.".to_string());
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
    // Bounded: a wedged CEF UI thread would otherwise block the command reader
    // forever, and the app has no way to tell that apart from a slow page.
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

/// Runs `f` against one browser's host. UI thread only.
pub fn with_host<T>(id: BrowserId, f: impl FnOnce(&BrowserHost) -> T) -> Result<T, String> {
    BROWSERS.with(|cell| {
        let browsers = cell.borrow();
        let state = browsers
            .get(&id)
            .ok_or_else(|| format!("CEF viewport {id} is not open."))?;
        let host = state
            .browser
            .host()
            .ok_or_else(|| "CEF browser host is unavailable.".to_string())?;
        Ok(f(&host))
    })
}

/// Runs `f` against one browser. UI thread only. Mirrors [`with_host`], for the
/// calls that live on `Browser` itself.
///
/// Reports an unknown id rather than doing nothing: a silent no-op here means a
/// mis-addressed navigate looks exactly like a page that refused to load.
fn with_browser(id: BrowserId, f: impl FnOnce(&Browser)) -> Result<(), String> {
    BROWSERS.with(|cell| {
        let browsers = cell.borrow();
        let state = browsers
            .get(&id)
            .ok_or_else(|| format!("CEF viewport {id} is not open."))?;
        f(&state.browser);
        Ok(())
    })
}

/// Creates a browser under `id`, replacing any existing one with that id.
/// UI thread only.
#[allow(clippy::too_many_arguments)]
pub fn open_browser(
    id: BrowserId,
    url: String,
    width: i32,
    height: i32,
    scale_factor: f32,
    sink: Sink,
) -> Result<(), String> {
    if !is_initialized() {
        return Err("CEF is not initialized.".to_string());
    }
    close_browser(id);

    let view = ViewState::new(width, height, scale_factor);
    let mut client = OsrClient::new(
        OsrRenderHandler::new(view.clone(), sink.clone(), id),
        OsrDisplayHandler::new(sink.clone(), id),
        OsrLoadHandler::new(sink, id),
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
    BROWSERS.with(|cell| {
        cell.borrow_mut().insert(id, BrowserState { browser, view });
    });
    Ok(())
}

/// UI thread only.
pub fn resize_browser(
    id: BrowserId,
    width: i32,
    height: i32,
    scale_factor: f32,
) -> Result<(), String> {
    BROWSERS.with(|cell| {
        let browsers = cell.borrow();
        let state = browsers
            .get(&id)
            .ok_or_else(|| format!("CEF viewport {id} is not open."))?;
        state.view.resize(width, height, scale_factor);
        if let Some(host) = state.browser.host() {
            host.notify_screen_info_changed();
            host.was_resized();
        }
        Ok(())
    })
}

/// UI thread only.
pub fn reload_browser(id: BrowserId) -> Result<(), String> {
    with_browser(id, |browser| browser.reload())
}

/// Navigates in place, pushing a real Chromium history entry.
///
/// This is what makes [`go_back`] work: the app deliberately keeps no history
/// list of its own, because Chromium's is the only one that sees in-page
/// navigations. UI thread only.
pub fn navigate_browser(id: BrowserId, url: String) -> Result<(), String> {
    with_browser(id, |browser| {
        if let Some(frame) = browser.main_frame() {
            let url: CefString = url.as_str().into();
            frame.load_url(Some(&url));
        }
    })
}

/// UI thread only.
pub fn go_back(id: BrowserId) -> Result<(), String> {
    with_browser(id, |browser| browser.go_back())
}

/// UI thread only.
pub fn go_forward(id: BrowserId) -> Result<(), String> {
    with_browser(id, |browser| browser.go_forward())
}

/// UI thread only.
pub fn close_browser(id: BrowserId) {
    let state = BROWSERS.with(|cell| cell.borrow_mut().remove(&id));
    if let Some(state) = state {
        if let Some(host) = state.browser.host() {
            host.close_browser(1);
        }
    }
}

/// Closes every browser. UI thread only; used on shutdown.
pub fn close_all_browsers() {
    let states = BROWSERS.with(|cell| cell.borrow_mut().drain().collect::<Vec<_>>());
    for (_, state) in states {
        if let Some(host) = state.browser.host() {
            host.close_browser(1);
        }
    }
}
