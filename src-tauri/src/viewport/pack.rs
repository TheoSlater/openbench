//! Downloading and installing the CEF runtime pack.
//!
//! The pack is the helper binary plus the ~330MB CEF runtime, published as a
//! release asset keyed on the CEF version rather than the app version, so a
//! normal app release never rebuilds it and an installed pack survives app
//! updates.
//!
//! Shape deliberately mirrors `download_whisper_model`: stream to a `.part`
//! file, emit progress, verify, then move into place. Extraction shells out to
//! `tar`, as `build.rs` already does for ONNX Runtime, rather than pulling in
//! archive crates the app would otherwise never need.

use futures::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use super::CEF_VERSION;

/// Release that carries the packs. Tagged separately from app releases.
const PACK_TAG: &str = "cef-pack-150.0.10";
const PACK_REPO: &str = "monolabsdev/poly-ui";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackStatus {
    /// The helper is present and runnable.
    pub installed: bool,
    /// A pack is published for this platform at all.
    pub supported: bool,
    pub version: String,
}

/// `None` on platforms with no published pack. macOS is absent until its helper
/// `.app` bundles and signing are done.
fn asset_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("polyui-viewport-linux-x64.tar.gz"),
        ("linux", "aarch64") => Some("polyui-viewport-linux-arm64.tar.gz"),
        ("windows", "x86_64") => Some("polyui-viewport-windows-x64.tar.gz"),
        _ => None,
    }
}

/// Where an installed pack lives. Versioned, so bumping CEF is a clean fresh
/// install rather than a half-replaced runtime.
pub fn install_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or_else(|| "OS data directory is unavailable.".to_string())?
        .join("com.tslater.polyui/viewport")
        .join(CEF_VERSION))
}

pub fn status() -> PackStatus {
    PackStatus {
        installed: super::process::is_installed(),
        supported: asset_name().is_some(),
        version: CEF_VERSION.to_string(),
    }
}

#[tauri::command]
pub fn viewport_pack_status() -> PackStatus {
    status()
}

/// Downloads and installs the pack, emitting `viewport-pack-progress`.
#[tauri::command]
pub async fn viewport_pack_install(app_handle: AppHandle) -> Result<(), String> {
    let asset = asset_name()
        .ok_or_else(|| "No browser runtime is published for this platform.".to_string())?;
    let target = install_dir()?;
    if super::process::is_installed() {
        return Ok(());
    }

    let url =
        format!("https://github.com/{PACK_REPO}/releases/download/{PACK_TAG}/{asset}");
    let parent = target
        .parent()
        .ok_or_else(|| "Invalid browser runtime path.".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;

    // Staged next to the destination so the final move is same-filesystem, and
    // a killed download can never leave a half-extracted directory that looks
    // installed.
    let archive = parent.join(format!("{CEF_VERSION}.tar.gz.part"));
    let staging = parent.join(format!("{CEF_VERSION}.incomplete"));
    let _ = tokio::fs::remove_file(&archive).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;

    let response = reqwest::get(&url)
        .await
        .map_err(|error| format!("Could not reach the browser runtime download: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Browser runtime download failed: {error}"))?;
    let total_bytes = response.content_length();
    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|error| error.to_string())?;
    let mut downloaded_bytes = 0_u64;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded_bytes += chunk.len() as u64;
        let _ = app_handle.emit(
            "viewport-pack-progress",
            PackProgress {
                downloaded_bytes,
                total_bytes,
            },
        );
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);

    if let Some(total) = total_bytes {
        if downloaded_bytes != total {
            let _ = tokio::fs::remove_file(&archive).await;
            return Err(format!(
                "Browser runtime download incomplete: expected {total} bytes, got {downloaded_bytes}."
            ));
        }
    }

    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|error| error.to_string())?;
    extract(&archive, &staging).await?;
    let _ = tokio::fs::remove_file(&archive).await;

    if !helper_in(&staging) {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err("Browser runtime archive did not contain the viewport helper.".to_string());
    }

    // Rename last: until this succeeds, nothing looks installed.
    let _ = tokio::fs::remove_dir_all(&target).await;
    tokio::fs::rename(&staging, &target)
        .await
        .map_err(|error| format!("Could not install the browser runtime: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn viewport_pack_remove() -> Result<(), String> {
    super::process::shutdown();
    let target = install_dir()?;
    match tokio::fs::remove_dir_all(&target).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn helper_in(dir: &Path) -> bool {
    let name = if cfg!(windows) {
        "polyui-viewport.exe"
    } else {
        "polyui-viewport"
    };
    dir.join(name).is_file()
}

/// `tar` is present on every supported Linux and on Windows 10+ (bsdtar), and
/// preserves the executable bit. Same call shape `build.rs` uses for ONNX.
async fn extract(archive: &Path, into: &Path) -> Result<(), String> {
    let output = tokio::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(into)
        .output()
        .await
        .map_err(|error| format!("Could not run tar to unpack the browser runtime: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Unpacking the browser runtime failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_is_versioned_by_cef_release() {
        // A CEF bump must change the install directory, or a stale runtime is
        // left in place next to a helper built against a different libcef.
        assert!(install_dir().unwrap().ends_with(CEF_VERSION));
        assert!(PACK_TAG.ends_with(CEF_VERSION));
    }

    #[test]
    fn unsupported_platforms_report_rather_than_guess() {
        // macOS has no pack yet; status must say so instead of offering an
        // install that would 404.
        if asset_name().is_none() {
            assert!(!status().supported);
        } else {
            assert!(status().supported);
        }
    }
}
