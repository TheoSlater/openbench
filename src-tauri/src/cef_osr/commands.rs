//! Tauri command surface for the viewport.
//!
//! Arguments are validated here, on the invoking thread, so the CEF UI thread
//! only ever receives values it can use as-is.

use tauri::ipc::{Channel, InvokeResponseBody};

use super::browser::{
    close_browser, go_back_browser, go_forward_browser, navigate_browser, on_cef_ui, open_browser,
    reload_browser, resize_browser,
};
use super::handlers::NavState;
use super::input::{dispatch_input, CefInputEvent};
use super::lifecycle::{enabled_on_next_start, set_enabled};

const MAX_DEVICE_SCALE_FACTOR: f64 = 8.0;

/// Rejects anything the viewport must never load. `javascript:` and `file:` in
/// particular would run with the page's privileges, so scheme checking happens
/// here rather than being trusted to the caller.
fn browsable_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("CEF viewport only accepts http/https URLs.".to_string());
    }
    Ok(())
}

/// Validated viewport geometry in CSS pixels plus its device scale factor.
struct Geometry {
    width: i32,
    height: i32,
    scale_factor: f32,
}

fn geometry(width: u32, height: u32, scale_factor: f64) -> Result<Geometry, String> {
    let width = i32::try_from(width).map_err(|_| "CEF viewport width is too large.".to_string())?;
    let height =
        i32::try_from(height).map_err(|_| "CEF viewport height is too large.".to_string())?;
    if width <= 0 || height <= 0 {
        return Err("CEF viewport dimensions must be positive.".to_string());
    }
    if !scale_factor.is_finite() || scale_factor <= 0.0 || scale_factor > MAX_DEVICE_SCALE_FACTOR {
        return Err("CEF viewport scale factor is invalid.".to_string());
    }
    Ok(Geometry {
        width,
        height,
        scale_factor: scale_factor as f32,
    })
}

#[tauri::command]
pub fn cef_viewport_open(
    url: String,
    width: u32,
    height: u32,
    scale_factor: f64,
    on_frame: Channel<InvokeResponseBody>,
    on_cursor: Channel<String>,
    on_address: Channel<String>,
    on_nav_state: Channel<NavState>,
) -> Result<(), String> {
    browsable_url(&url)?;
    let geometry = geometry(width, height, scale_factor)?;

    // Logged: an open that never returns a frame is the one CEF failure the
    // frontend cannot describe on its own.
    crate::startup_log::log_phase("CEF viewport open");
    let opened = on_cef_ui(move || {
        open_browser(
            url,
            geometry.width,
            geometry.height,
            geometry.scale_factor,
            on_frame,
            on_cursor,
            on_address,
            on_nav_state,
        )
    })
    .and_then(|result| result);
    match &opened {
        Ok(()) => crate::startup_log::log_phase("CEF viewport opened"),
        Err(error) => crate::startup_log::log_error(format!("CEF viewport open failed: {error}")),
    }
    opened
}

/// Navigates the open browser in place.
///
/// Distinct from `cef_viewport_open`, which tears the browser down and builds a
/// new one: that loses Chromium's session history, so back/forward would have
/// nothing to walk.
#[tauri::command]
pub fn cef_viewport_navigate(url: String) -> Result<(), String> {
    browsable_url(&url)?;
    on_cef_ui(move || navigate_browser(url))
}

#[tauri::command]
pub fn cef_viewport_back() -> Result<(), String> {
    on_cef_ui(go_back_browser)
}

#[tauri::command]
pub fn cef_viewport_forward() -> Result<(), String> {
    on_cef_ui(go_forward_browser)
}

#[tauri::command]
pub fn cef_viewport_resize(width: u32, height: u32, scale_factor: f64) -> Result<(), String> {
    let geometry = geometry(width, height, scale_factor)?;
    on_cef_ui(move || resize_browser(geometry.width, geometry.height, geometry.scale_factor))
}

#[tauri::command]
pub fn cef_viewport_close() -> Result<(), String> {
    on_cef_ui(close_browser)
}

#[tauri::command]
pub fn cef_viewport_reload() -> Result<(), String> {
    on_cef_ui(reload_browser)
}

#[tauri::command]
pub fn cef_viewport_input(events: Vec<CefInputEvent>) -> Result<(), String> {
    on_cef_ui(move || dispatch_input(events))?
}

#[tauri::command]
pub fn cef_viewport_set_enabled(enabled: bool) -> Result<(), String> {
    set_enabled(enabled)
}

#[tauri::command]
pub fn cef_viewport_is_enabled() -> bool {
    enabled_on_next_start()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_urls_reach_the_browser() {
        assert!(browsable_url("https://example.com").is_ok());
        assert!(browsable_url("http://localhost:1420").is_ok());
        assert!(browsable_url("javascript:alert(1)").is_err());
        assert!(browsable_url("file:///etc/passwd").is_err());
        assert!(browsable_url("not a url").is_err());
    }

    #[test]
    fn geometry_rejects_unusable_viewport_sizes() {
        assert!(geometry(0, 100, 1.0).is_err());
        assert!(geometry(100, 0, 1.0).is_err());
        assert!(geometry(100, 100, 0.0).is_err());
        assert!(geometry(100, 100, f64::NAN).is_err());
        assert!(geometry(100, 100, 9.0).is_err());
        assert!(geometry(100, 100, 2.0).is_ok());
    }
}
