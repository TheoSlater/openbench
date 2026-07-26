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

use std::path::{Path, PathBuf};

/// The CEF build the helper is compiled against. Also the directory name the
/// downloaded pack installs under, so a version bump is a clean fresh install
/// rather than a half-replaced runtime.
pub const CEF_VERSION: &str = "150.0.10";

const ENABLED_FILE: &str = "com.tslater.polyui/cef-enabled";

fn enabled_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|path| path.join(ENABLED_FILE))
        .ok_or_else(|| "OS config directory is unavailable.".to_string())
}

/// The user's browser preference. Unlike the in-process version this is no
/// longer read at startup — nothing is decided at boot now that the helper
/// spawns lazily on first use.
pub fn enabled() -> bool {
    enabled_path().is_ok_and(|path| path.is_file())
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    set_enabled_at(&enabled_path()?, enabled)
}

fn set_enabled_at(path: &Path, enabled: bool) -> Result<(), String> {
    if enabled {
        let parent = path
            .parent()
            .ok_or_else(|| "Viewport preference path has no parent directory.".to_string())?;
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
    fn viewport_preference_can_be_enabled_and_disabled() {
        let path = std::env::temp_dir().join(format!("polyui-cef-enabled-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);

        set_enabled_at(&path, true).expect("enable viewport preference");
        assert!(path.is_file());

        set_enabled_at(&path, false).expect("disable viewport preference");
        assert!(!path.exists());
    }
}
