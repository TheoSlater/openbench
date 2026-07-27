//! Tauri command surface for the viewport.
//!
//! Every command validates its arguments here and then writes one JSON line to
//! the helper. Input events cross as an opaque value: only the helper knows the
//! `CefInputEvent` schema, which keeps CEF types out of this crate entirely.

use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::process::{self, BrowserChannels, BrowserId};

const MAX_DEVICE_SCALE_FACTOR: f64 = 8.0;

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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn cef_viewport_open(
    id: BrowserId,
    url: String,
    width: u32,
    height: u32,
    scale_factor: f64,
    on_frame: Channel<InvokeResponseBody>,
    on_cursor: Channel<String>,
    on_address: Channel<String>,
    on_nav_state: Channel<serde_json::Value>,
    on_error: Channel<String>,
) -> Result<(), String> {
    browsable_url(&url)?;
    let geometry = geometry(width, height, scale_factor)?;

    // Registered before the command is sent: the helper can paint before the
    // write returns, and a frame with nowhere to go would be dropped.
    process::register(
        id,
        BrowserChannels {
            on_frame,
            on_cursor,
            on_address,
            on_nav_state,
            on_error,
        },
    );

    let result = process::send(json!({
        "cmd": "open",
        "id": id,
        "url": url,
        "width": geometry.width,
        "height": geometry.height,
        "scaleFactor": geometry.scale_factor,
    }));
    if result.is_err() {
        process::unregister(id);
    }
    result
}

#[tauri::command]
pub fn cef_viewport_resize(
    id: BrowserId,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> Result<(), String> {
    let geometry = geometry(width, height, scale_factor)?;
    process::send(json!({
        "cmd": "resize",
        "id": id,
        "width": geometry.width,
        "height": geometry.height,
        "scaleFactor": geometry.scale_factor,
    }))
}

#[tauri::command]
pub fn cef_viewport_close(id: BrowserId) -> Result<(), String> {
    process::unregister(id);
    process::send(json!({ "cmd": "close", "id": id }))
}

#[tauri::command]
pub fn cef_viewport_reload(id: BrowserId) -> Result<(), String> {
    process::send(json!({ "cmd": "reload", "id": id }))
}

/// Navigates in place. Distinct from `cef_viewport_open`, which builds a new
/// browser and so resets the session history back/forward walk.
#[tauri::command]
pub fn cef_viewport_navigate(id: BrowserId, url: String) -> Result<(), String> {
    browsable_url(&url)?;
    process::send(json!({ "cmd": "navigate", "id": id, "url": url }))
}

#[tauri::command]
pub fn cef_viewport_back(id: BrowserId) -> Result<(), String> {
    process::send(json!({ "cmd": "back", "id": id }))
}

#[tauri::command]
pub fn cef_viewport_forward(id: BrowserId) -> Result<(), String> {
    process::send(json!({ "cmd": "forward", "id": id }))
}

#[tauri::command]
pub fn cef_viewport_input(id: BrowserId, events: serde_json::Value) -> Result<(), String> {
    process::send(json!({ "cmd": "input", "id": id, "events": events }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometry_rejects_unusable_viewport_sizes() {
        assert!(geometry(0, 100, 1.0).is_err());
        assert!(geometry(100, 0, 1.0).is_err());
        assert!(geometry(100, 100, 0.0).is_err());
        assert!(geometry(100, 100, f64::NAN).is_err());
        assert!(geometry(100, 100, 9.0).is_err());
        assert!(geometry(100, 100, 2.0).is_ok());
    }

    #[test]
    fn only_http_urls_reach_the_browser() {
        assert!(browsable_url("https://example.com").is_ok());
        assert!(browsable_url("http://localhost:1420").is_ok());
        assert!(browsable_url("javascript:alert(1)").is_err());
        assert!(browsable_url("file:///etc/passwd").is_err());
        assert!(browsable_url("not a url").is_err());
    }
}
