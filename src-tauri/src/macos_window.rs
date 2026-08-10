//! macOS-only window material setup.
//!
//! The native effect is installed behind the Tauri WebView. The frontend
//! intentionally leaves only the sidebar/titlebar DOM transparent; the chat
//! canvas remains opaque and therefore masks the rest of the native effect.
//! This keeps the material useful as window hierarchy rather than turning the
//! whole application into a glass surface.

use tauri::WebviewWindow;
use window_vibrancy::{
    apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
    NSVisualEffectMaterial, NSVisualEffectState,
};

/// Configure the main window's macOS titlebar and native material.
///
/// `window-vibrancy` exposes Liquid Glass only on macOS 26+. Older systems
/// (and systems where the private Glass API is unavailable) use the stable
/// semantic sidebar material instead. Setup runs once per native window, so
/// this function does not retain AppKit pointers or stack views during reloads.
pub fn configure(window: &WebviewWindow) {
    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);

    // The AppKit window already supplies its native corner. Applying a radius
    // to the full-window glass view would create a second nested silhouette.
    let liquid_glass = LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular)
        .opaque(false);

    if let Err(error) = apply_liquid_glass(window, liquid_glass) {
        log::info!("Liquid Glass unavailable; using sidebar vibrancy: {error}");

        if let Err(fallback_error) = apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            None,
        ) {
            log::warn!("Failed to apply macOS sidebar vibrancy: {fallback_error}");
        }
    }
}
