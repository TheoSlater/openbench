//! The browser viewport, hosted in a separate process.
//!
//! Why out of process: `libcef.so` is 261MB and was a `DT_NEEDED` dependency of
//! this binary, so every user on every platform downloaded Chromium for a
//! feature that is experimental, off by default, and Linux/Windows only. This
//! crate now links no CEF at all; [`process`] spawns `polyui-viewport`, which
//! does.
//!
//! It also buys back things the shared process cost us: no GTK3/GTK4 conflict
//! with webkit2gtk, no SQLite symbol interposition breaking CEF's NSS init, no
//! ordering constraint forcing CEF to initialize before Tauri, and — since the
//! helper holds Chromium's per-profile process singleton instead of the app —
//! no singleton collision between the app and its own browser.
//!
//! macOS is no longer excluded by construction. CEF there needs helper `.app`
//! bundles rather than re-executing the host binary, which is exactly the shape
//! this now has; the remaining work is bundling and signing.

pub mod commands;
pub mod pack;
pub mod process;


/// The CEF build the helper is compiled against. Also the directory name the
/// downloaded pack installs under, so a version bump is a clean fresh install
/// rather than a half-replaced runtime.
pub const CEF_VERSION: &str = "150.0.10";

/// The helper executable's name. Shared so the installer verifies the same file
/// the launcher looks for.
pub fn helper_name() -> &'static str {
    if cfg!(windows) {
        "polyui-viewport.exe"
    } else {
        "polyui-viewport"
    }
}

/// Where an installed pack lives. Versioned, so bumping CEF is a clean fresh
/// install rather than a half-replaced runtime.
pub fn install_dir() -> Result<std::path::PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or_else(|| "OS data directory is unavailable.".to_string())?
        .join("com.tslater.polyui/viewport")
        .join(CEF_VERSION))
}
