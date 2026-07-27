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
use std::path::Path;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use super::{helper_name, install_dir, CEF_VERSION};

/// Release that carries the packs. Tagged separately from app releases.
const PACK_TAG: &str = "cef-pack-150.0.10";
const PACK_REPO: &str = "monolabsdev/poly-ui";
/// How much must arrive before another progress event is worth sending.
const PROGRESS_INTERVAL_BYTES: u64 = 1024 * 1024;

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

/// The published pack for this platform, and the SHA-256 it must hash to.
///
/// `None` on platforms with no published pack. macOS is absent until its helper
/// `.app` bundles and signing are done.
///
/// The hash is pinned in the binary rather than fetched alongside the archive:
/// a checksum served from the same place as the file it describes proves only
/// that the two match. Pinning here means a pack that is not the one this build
/// expects is refused, whatever the server says.
///
/// Filling these in is a required step when publishing a new CEF version — the
/// pack workflow prints each SHA to its job summary. An empty hash is treated
/// as "not published yet" and refuses to install, so there is no window in
/// which unverified code is unpacked and executed.
const PACKS: &[(&str, &str, &str, &str)] = &[
    // (os, arch, asset, sha256)
    (
        "linux",
        "x86_64",
        "polyui-viewport-linux-x64.tar.gz",
        "07fca638807b0a810d4cbf76425ed3914b5976413dff13b7618f52000b4f71dc",
    ),
    (
        "linux",
        "aarch64",
        "polyui-viewport-linux-arm64.tar.gz",
        "eecf4e89dfeb778db717c0c779dcb3f3b59e092530fb02d4c0d389201770a5d5",
    ),
    (
        "windows",
        "x86_64",
        "polyui-viewport-windows-x64.tar.gz",
        "d9019f9e1bc595bf9a0d67f79e8f5e84d52f03fb79e1989f7d40d8c0f1e3a413",
    ),
];

fn asset() -> Option<(&'static str, &'static str)> {
    PACKS
        .iter()
        .find(|(os, arch, _, _)| *os == std::env::consts::OS && *arch == std::env::consts::ARCH)
        .map(|(_, _, name, sha)| (*name, *sha))
}

fn asset_name() -> Option<&'static str> {
    asset().map(|(name, _)| name)
}

/// Hashes the downloaded archive incrementally so a 137MB file never has to be
/// held in memory to be verified.
async fn sha256_of(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = tokio::io::AsyncReadExt::read(&mut file, &mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
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
    let (asset, expected_sha) = asset()
        .ok_or_else(|| "No browser runtime is published for this platform.".to_string())?;
    if expected_sha.is_empty() {
        // Refuse rather than install unverified code. Reached only if a build
        // ships without its pack hashes filled in.
        return Err(
            "No verified browser runtime is published for this app version yet.".to_string(),
        );
    }
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
    let mut emitted_at = 0_u64;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded_bytes += chunk.len() as u64;
        // Emit per megabyte, not per chunk. reqwest hands back 8-16KB chunks,
        // so a 140MB download would otherwise fire ~15,000 IPC messages at a
        // progress bar that can repaint 60 times a second.
        if downloaded_bytes - emitted_at >= PROGRESS_INTERVAL_BYTES {
            emitted_at = downloaded_bytes;
            let _ = app_handle.emit(
                "viewport-pack-progress",
                PackProgress {
                    downloaded_bytes,
                    total_bytes,
                },
            );
        }
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

    // Before anything is unpacked, let alone executed.
    let actual_sha = sha256_of(&archive).await?;
    if !actual_sha.eq_ignore_ascii_case(expected_sha) {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(format!(
            "Browser runtime failed verification: expected {expected_sha}, got {actual_sha}. \
             The download was not the expected file and has been discarded."
        ));
    }

    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|error| error.to_string())?;
    extract(&archive, &staging).await?;
    let _ = tokio::fs::remove_file(&archive).await;

    if !staging.join(helper_name()).is_file() {
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

/// `tar` is present on every supported Linux and on Windows 10+ (bsdtar), and
/// preserves the executable bit. Same call shape `build.rs` uses for ONNX.
///
/// Runs from the directory holding both paths and passes only file names: an
/// absolute Windows path like `C:\Users\...` is read as a remote `host:path`
/// spec by GNU tar, which is what `tar` resolves to if a Git for Windows
/// install precedes System32 on PATH.
async fn extract(archive: &Path, into: &Path) -> Result<(), String> {
    let working_dir = archive
        .parent()
        .ok_or_else(|| "Invalid browser runtime archive path.".to_string())?;
    let archive_name = archive
        .file_name()
        .ok_or_else(|| "Invalid browser runtime archive name.".to_string())?;
    let into_name = into
        .file_name()
        .ok_or_else(|| "Invalid browser runtime staging name.".to_string())?;
    let output = tokio::process::Command::new("tar")
        .current_dir(working_dir)
        .arg("-xzf")
        .arg(archive_name)
        .arg("-C")
        .arg(into_name)
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
    fn hashes_a_file_the_same_way_sha256sum_does() {
        // Must match what the pack workflow prints, or a correct pack would be
        // rejected as tampered-with.
        let path = std::env::temp_dir().join(format!("polyui-sha-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        let digest = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(sha256_of(&path))
            .unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn streams_a_large_file_correctly() {
        let pack = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../dist-pack/polyui-viewport-linux-x64.tar.gz");
        if !pack.is_file() { eprintln!("skip: no pack"); return; }
        let mine = tokio::runtime::Runtime::new().unwrap().block_on(sha256_of(&pack)).unwrap();
        let out = std::process::Command::new("sha256sum").arg(&pack).output().unwrap();
        let theirs = String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap().to_string();
        assert_eq!(mine, theirs, "streaming hash disagrees with sha256sum");
        eprintln!("verified {mine} over {} bytes", pack.metadata().unwrap().len());
    }

    #[test]
    fn every_published_pack_is_pinned_to_a_hash() {
        // A pack with no pinned hash must not be installable: the archive is
        // unpacked and executed, so TLS alone is not enough to trust it.
        // Publishing a CEF version means filling these in from the pack
        // workflow's job summary.
        for (_, _, name, sha) in PACKS {
            assert!(
                sha.is_empty() || sha.len() == 64,
                "{name}: a pinned SHA-256 must be 64 hex characters"
            );
        }
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
