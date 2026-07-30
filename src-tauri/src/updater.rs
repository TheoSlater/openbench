use crate::AppState;
use reqwest::Client;
use serde::Serialize;
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::thread;
use std::time::Duration;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

const GITHUB_REPO: &str = "monolabsdev/poly-ui";
const CHECK_INTERVAL_SECS: u64 = 1800;
const APP_NAME: &str = "PolyUI";

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize, Clone)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: Option<i64>,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub version: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub size: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct UpdateProgress {
    pub status: String,
    pub percent: f64,
    pub bytes: u64,
    pub total: u64,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(state: State<'_, AppState>) -> Result<UpdateInfo, String> {
    {
        let mut last = state.last_update_check.lock().await;
        if let Some(instant) = *last {
            if instant.elapsed().as_secs() < CHECK_INTERVAL_SECS {
                return Err("rate_limited".into());
            }
        }
        *last = Some(Instant::now());
    }

    let client = Client::builder()
        .user_agent("polyui-updater")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error {}: {}", status, body));
    }
    let release: GithubRelease = resp.json().await.map_err(|e| e.to_string())?;

    let current = env!("CARGO_PKG_VERSION");
    let remote = release.tag_name.trim_start_matches('v');

    if !is_newer_version(remote, current)? {
        return Ok(UpdateInfo {
            has_update: false,
            version: release.tag_name,
            download_url: None,
            asset_name: None,
            size: None,
        });
    }

    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let asset = select_update_asset(&release.assets, os, arch);

    match asset {
        Some(a) => Ok(UpdateInfo {
            has_update: true,
            version: release.tag_name,
            download_url: Some(a.browser_download_url.clone()),
            asset_name: Some(a.name.clone()),
            size: a.size,
        }),
        None => Ok(UpdateInfo {
            has_update: true,
            version: release.tag_name,
            download_url: None,
            asset_name: None,
            size: None,
        }),
    }
}

fn select_update_asset<'a>(
    assets: &'a [GithubAsset],
    os: &str,
    arch: &str,
) -> Option<&'a GithubAsset> {
    if os == "linux" {
        return select_linux_update_asset(assets, arch, &linux_asset_suffixes());
    }

    let arch_aliases: &[&str] = match arch {
        "x86_64" => &["x64", "amd64", "x86_64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[arch],
    };
    let known_arches = ["x64", "amd64", "x86_64", "aarch64", "arm64"];

    let matches_platform = |a: &&GithubAsset| {
        let n = a.name.to_lowercase();
        if n.contains("ollama") {
            return false;
        }

        match os {
            "windows" => n.contains("setup") || n.ends_with(".exe"),
            "macos" => {
                n.contains("macos")
                    || n.contains("darwin")
                    || n.ends_with(".dmg")
                    || n.contains(".tar.gz")
            }
            "linux" => n.ends_with(".appimage") || n.ends_with(".deb") || n.contains("linux"),
            _ => false,
        }
    };
    let matching_assets = assets.iter().filter(matches_platform);
    matching_assets
        .clone()
        .find(|a| {
            let name = a.name.to_lowercase();
            arch_aliases.iter().any(|alias| name.contains(alias))
        })
        .or_else(|| {
            matching_assets.into_iter().find(|a| {
                let name = a.name.to_lowercase();
                !known_arches.iter().any(|arch| name.contains(arch))
            })
        })
}

fn matching_arch_assets<'a>(
    assets: &'a [GithubAsset],
    arch: &str,
    matches_platform: impl Fn(&GithubAsset) -> bool,
) -> Vec<&'a GithubAsset> {
    let arch_aliases: &[&str] = match arch {
        "x86_64" => &["x64", "amd64", "x86_64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[arch],
    };
    let known_arches = ["x64", "amd64", "x86_64", "aarch64", "arm64"];
    let matching_assets: Vec<&GithubAsset> =
        assets.iter().filter(|a| matches_platform(a)).collect();
    let arch_matches: Vec<&GithubAsset> = matching_assets
        .iter()
        .copied()
        .filter(|a| {
            let name = a.name.to_lowercase();
            arch_aliases.iter().any(|alias| name.contains(alias))
        })
        .collect();

    if !arch_matches.is_empty() {
        return arch_matches;
    }

    matching_assets
        .into_iter()
        .filter(|a| {
            let name = a.name.to_lowercase();
            !known_arches.iter().any(|arch| name.contains(arch))
        })
        .collect()
}

fn command_exists(command: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|path| path.join(command).is_file()))
}

fn linux_asset_suffixes() -> Vec<&'static str> {
    if command_exists("apt") || command_exists("dpkg") {
        vec![".deb", ".appimage", ".rpm"]
    } else if command_exists("dnf") || command_exists("zypper") || command_exists("rpm") {
        vec![".rpm", ".appimage", ".deb"]
    } else {
        vec![".appimage", ".deb", ".rpm"]
    }
}

fn select_linux_update_asset<'a>(
    assets: &'a [GithubAsset],
    arch: &str,
    suffixes: &[&str],
) -> Option<&'a GithubAsset> {
    let candidates = matching_arch_assets(assets, arch, |asset| {
        let name = asset.name.to_lowercase();
        !name.contains("ollama")
            && (name.ends_with(".appimage") || name.ends_with(".deb") || name.ends_with(".rpm"))
    });

    suffixes
        .iter()
        .find_map(|suffix| {
            candidates
                .iter()
                .copied()
                .find(|asset| asset.name.to_lowercase().ends_with(&suffix.to_lowercase()))
        })
        .or_else(|| candidates.first().copied())
}

fn is_newer_version(remote: &str, current: &str) -> Result<bool, String> {
    let remote = semver::Version::parse(remote.trim_start_matches('v'))
        .map_err(|e| format!("Invalid release version '{}': {}", remote, e))?;
    let current = semver::Version::parse(current.trim_start_matches('v'))
        .map_err(|e| format!("Invalid app version '{}': {}", current, e))?;
    Ok(remote > current)
}

#[derive(Debug, PartialEq)]
enum LinuxInstallKind {
    AppImage,
    Deb,
    Rpm,
}

fn linux_install_kind(path: &Path) -> Option<LinuxInstallKind> {
    let name = path.file_name()?.to_str()?;
    let lower_name = name.to_lowercase();

    if lower_name.ends_with(".appimage") {
        Some(LinuxInstallKind::AppImage)
    } else if lower_name.ends_with(".deb") {
        Some(LinuxInstallKind::Deb)
    } else if lower_name.ends_with(".rpm") {
        Some(LinuxInstallKind::Rpm)
    } else {
        None
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn linux_install_script(path: &Path) -> Result<String, String> {
    let package = shell_quote(&path.to_string_lossy());
    let kind =
        linux_install_kind(path).ok_or_else(|| "Unsupported Linux update package".to_string())?;
    let install = match kind {
        LinuxInstallKind::AppImage => format!("chmod +x {package}\nexec {package} --no-sandbox\n"),
        LinuxInstallKind::Deb => format!(
            r#"if command -v apt >/dev/null 2>&1; then
  $AS_ROOT DEBIAN_FRONTEND=noninteractive apt install -y {package}
else
  $AS_ROOT dpkg -i {package}
fi
"#
        ),
        LinuxInstallKind::Rpm => format!(
            r#"if command -v dnf >/dev/null 2>&1; then
  $AS_ROOT dnf install -y {package}
elif command -v zypper >/dev/null 2>&1; then
  $AS_ROOT zypper install -y {package}
else
  $AS_ROOT rpm -Uvh {package}
fi
"#
        ),
    };

    Ok(format!(
        r#"#!/bin/sh
set -eu
sleep 2
if command -v pkexec >/dev/null 2>&1; then
  AS_ROOT="pkexec env"
elif [ "$(id -u)" -eq 0 ]; then
  AS_ROOT="env"
elif command -v sudo >/dev/null 2>&1; then
  AS_ROOT="sudo env"
else
  echo "Install needs pkexec, sudo, or root." >&2
  exit 1
fi
{install}
# Relaunch after install
nohup /usr/bin/poly-ui > /dev/null 2>&1 &
"#
    ))
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    asset_name: String,
) -> Result<(), String> {
    let client = Client::builder()
        .user_agent("polyui-updater")
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Update download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let temp_dir = std::env::temp_dir().join("polyui-update");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let file_path = temp_dir.join(&asset_name);
    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        downloaded += chunk.len() as u64;
        file.write_all(&chunk).map_err(|e| e.to_string())?;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        let _ = app.emit(
            "update-progress",
            UpdateProgress {
                status: "downloading".into(),
                percent,
                bytes: downloaded,
                total,
                file_path: None,
                error: None,
            },
        );
    }

    {
        let mut path = state.update_download_path.lock().await;
        *path = Some(file_path.clone());
    }

    let _ = app.emit(
        "update-progress",
        UpdateProgress {
            status: "downloaded".into(),
            percent: 100.0,
            bytes: downloaded,
            total,
            file_path: Some(file_path.to_string_lossy().to_string()),
            error: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let file_path = {
        let p = state.update_download_path.lock().await;
        p.clone()
            .ok_or_else(|| "No update downloaded".to_string())?
    };

    let os = std::env::consts::OS;
    let fp = file_path.to_string_lossy();

    match os {
        "windows" => {
            std::process::Command::new(fp.as_ref())
                .spawn()
                .map_err(|e| format!("Failed to start installer: {}", e))?;

            #[cfg(target_os = "windows")]
            if let Ok(exe) = std::env::current_exe() {
                let exe_str = exe.to_string_lossy().to_string();
                let _ = std::process::Command::new("cmd")
                    .args([
                        "/c",
                        &format!("timeout /t 8 /nobreak >nul && start \"\" \"{}\"", exe_str),
                    ])
                    .creation_flags(0x08000000)
                    .spawn();
            }
        }
        "macos" => {
            let install_script = format!(
                r#"#!/bin/sh
sleep 2
VOLUME=$(hdiutil attach -quiet -nobrowse '{}' | tail -1 | awk '{{print $NF}}')
mkdir -p ~/Applications
cp -R "$VOLUME/{}.app" ~/Applications/
hdiutil detach -quiet "$VOLUME"
open ~/Applications/{}.app
rm -- "$0"
"#,
                fp, APP_NAME, APP_NAME
            );
            let script_path = std::env::temp_dir()
                .join("polyui-update")
                .join("install.sh");
            std::fs::create_dir_all(script_path.parent().unwrap()).ok();
            std::fs::write(&script_path, &install_script).map_err(|e| e.to_string())?;
            std::process::Command::new("chmod")
                .args(["+x", &script_path.to_string_lossy()])
                .spawn()
                .map_err(|e| e.to_string())?;
            std::process::Command::new(&script_path)
                .spawn()
                .map_err(|e| format!("Failed to start installer: {}", e))?;
        }
        "linux" => {
            let install_script = linux_install_script(&file_path)?;
            let script_path = std::env::temp_dir()
                .join("polyui-update")
                .join("install.sh");
            std::fs::create_dir_all(script_path.parent().unwrap()).ok();
            std::fs::write(&script_path, &install_script).map_err(|e| e.to_string())?;
            std::process::Command::new("sh")
                .arg(&script_path)
                .spawn()
                .map_err(|e| format!("Failed to start installer: {}", e))?;
        }
        _ => return Err("Unsupported OS".to_string()),
    }

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        app.exit(0);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> GithubAsset {
        GithubAsset {
            name: name.to_string(),
            browser_download_url: String::new(),
            size: None,
        }
    }

    #[test]
    fn windows_updater_ignores_ollama_bundle() {
        let assets = vec![
            asset("PolyUI_0.10.0_x64-setup-Ollama.exe"),
            asset("PolyUI_0.10.0_x64-setup.exe"),
        ];

        assert_eq!(
            select_update_asset(&assets, "windows", "x86_64").map(|asset| asset.name.as_str()),
            Some("PolyUI_0.10.0_x64-setup.exe")
        );
    }

    #[test]
    fn macos_updater_uses_dmg_instead_of_ollama_pkg() {
        let assets = vec![
            asset("PolyUI-Ollama.pkg"),
            asset("PolyUI_0.10.0_aarch64.dmg"),
        ];

        assert_eq!(
            select_update_asset(&assets, "macos", "aarch64").map(|asset| asset.name.as_str()),
            Some("PolyUI_0.10.0_aarch64.dmg")
        );
    }

    #[test]
    fn version_comparison_uses_semver_order() {
        assert!(is_newer_version("v0.11.0", "0.9.0").unwrap());
        assert!(!is_newer_version("v0.9.0", "0.11.0").unwrap());
    }

    #[test]
    fn version_comparison_handles_prereleases() {
        assert!(is_newer_version("v0.11.0", "0.11.0-rc.2").unwrap());
        assert!(!is_newer_version("v0.11.0-rc.1", "0.11.0-rc.2").unwrap());
    }

    #[test]
    fn windows_updater_selects_matching_architecture() {
        let assets = vec![
            asset("PolyUI_0.11.0_arm64-setup.exe"),
            asset("PolyUI_0.11.0_x64-setup.exe"),
        ];

        assert_eq!(
            select_update_asset(&assets, "windows", "x86_64").map(|asset| asset.name.as_str()),
            Some("PolyUI_0.11.0_x64-setup.exe")
        );
    }

    #[test]
    fn windows_updater_rejects_wrong_architecture() {
        let assets = vec![asset("PolyUI_0.11.0_arm64-setup.exe")];

        assert!(select_update_asset(&assets, "windows", "x86_64").is_none());
    }

    #[test]
    fn linux_updater_prefers_requested_package_type() {
        let assets = vec![
            asset("PolyUI_0.16.0_linux_x64.deb"),
            asset("PolyUI_0.16.0_linux_x64.rpm"),
            asset("PolyUI_0.16.0_linux_x64.AppImage"),
        ];

        assert_eq!(
            select_linux_update_asset(&assets, "x86_64", &[".rpm", ".appimage", ".deb"])
                .map(|asset| asset.name.as_str()),
            Some("PolyUI_0.16.0_linux_x64.rpm")
        );
    }

    #[test]
    fn linux_updater_falls_back_to_appimage() {
        let assets = vec![
            asset("PolyUI_0.16.0_linux_x64.deb"),
            asset("PolyUI_0.16.0_linux_x64.AppImage"),
        ];

        assert_eq!(
            select_linux_update_asset(&assets, "x86_64", &[".rpm", ".appimage", ".deb"])
                .map(|asset| asset.name.as_str()),
            Some("PolyUI_0.16.0_linux_x64.AppImage")
        );
    }

    #[test]
    fn linux_updater_rejects_unknown_package_type() {
        assert_eq!(
            linux_install_kind(std::path::Path::new("PolyUI.tar.gz")),
            None
        );
    }

    #[test]
    fn linux_updater_supports_rpm_packages() {
        assert_eq!(
            linux_install_kind(std::path::Path::new("PolyUI-0.16.0-linux-x64.rpm")),
            Some(LinuxInstallKind::Rpm)
        );
    }

    #[test]
    fn linux_deb_installer_prefers_apt_over_dpkg() {
        let script = linux_install_script(std::path::Path::new("/tmp/PolyUI.deb")).unwrap();

        assert!(script.contains("apt install -y"));
        assert!(script.contains("dpkg -i"));
    }

    #[test]
    fn linux_rpm_installer_supports_common_package_managers() {
        let script = linux_install_script(std::path::Path::new("/tmp/PolyUI.rpm")).unwrap();

        assert!(script.contains("dnf install -y"));
        assert!(script.contains("zypper install -y"));
        assert!(script.contains("rpm -Uvh"));
    }
}
