use std::path::{Path, PathBuf};
use std::process::Command;

const ORT_VERSION: &str = "1.24.2";

fn ort_download_url(target: &str) -> Option<(&'static str, bool)> {
    // (url, is_zip)
    match target {
        "aarch64-apple-darwin" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-osx-arm64-1.24.2.tgz", false)),
        "x86_64-apple-darwin" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-osx-x86-64-1.24.2.tgz", false)),
        "x86_64-unknown-linux-gnu" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-linux-x64-1.24.2.tgz", false)),
        "aarch64-unknown-linux-gnu" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-linux-aarch64-1.24.2.tgz", false)),
        "x86_64-pc-windows-msvc" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-win-x64-1.24.2.zip", true)),
        "aarch64-pc-windows-msvc" => Some(("https://github.com/microsoft/onnxruntime/releases/download/v1.24.2/onnxruntime-win-arm64-1.24.2.zip", true)),
        _ => None,
    }
}

fn library_name(target: &str) -> &'static str {
    if target.contains("windows") {
        "onnxruntime.dll"
    } else if target.contains("apple-darwin") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    }
}

fn find_library(library_name: &str, target: &str) -> Option<PathBuf> {
    if let Ok(lib_location) = std::env::var("DEP_ORT_LIB_LOCATION") {
        let path = PathBuf::from(lib_location).join(library_name);
        if path.exists() {
            return Some(path);
        }
    }

    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    if let Some(profile_dir) = out_dir.ancestors().nth(3) {
        let path = profile_dir.join(library_name);
        if path.exists() {
            return Some(path);
        }
    }

    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"),
    );
    for entry in std::fs::read_dir(manifest_dir.join("target/onnxruntime"))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
    {
        if entry.path().file_name().is_some_and(|n| n == library_name) {
            return Some(entry.path());
        }
    }

    if let Some(cache_dir) = ort_cache_dir() {
        let dfbin = cache_dir.join("dfbin").join(target);
        if dfbin.is_dir() {
            for entry in std::fs::read_dir(&dfbin).ok().into_iter().flatten() {
                let entry = entry.ok()?;
                if entry.path().is_dir() {
                    let path = entry.path().join(library_name);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
    }

    for var in &["ORT_LIB_LOCATION", "ORT_LIB_PATH"] {
        if let Ok(val) = std::env::var(var) {
            let p = PathBuf::from(&val);
            if p.is_dir() {
                let path = p.join(library_name);
                if path.exists() {
                    return Some(path);
                }
            } else if p.exists() && p.file_name().is_some_and(|n| n == library_name) {
                return Some(p);
            }
        }
    }

    None
}

fn ort_cache_dir() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("ORT_CACHE_DIR") {
        return Some(PathBuf::from(val));
    }
    if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Caches/pyke/ort"))
    } else if cfg!(target_os = "linux") {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
            .map(|h| h.join("ort"))
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|h| PathBuf::from(h).join("pyke/ort"))
    } else {
        None
    }
}

fn download_and_extract(url: &str, is_zip: bool, dest: &Path) {
    if is_zip {
        let zip = dest.join("download.zip");
        let status = Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&zip)
            .arg(url)
            .status()
            .expect("failed to run curl");
        if !status.success() {
            panic!("curl failed to download ONNX Runtime from {url}");
        }

        let ps = Command::new("powershell")
            .args([
                "-Command",
                &format!("Expand-Archive -Path '{}' -DestinationPath '{}' -Force", zip.display(), dest.display()),
            ])
            .status()
            .expect("failed to run powershell");
        if !ps.success() {
            panic!("powershell failed to extract ONNX Runtime zip");
        }
        let _ = std::fs::remove_file(&zip);
    } else {
        let tgz = dest.join("download.tar.gz");
        let status = Command::new("curl")
            .args(["-fsSL", "-o"])
            .arg(&tgz)
            .arg(url)
            .status()
            .expect("failed to run curl");
        if !status.success() {
            panic!("curl failed to download ONNX Runtime from {url}");
        }

        let extract_status = Command::new("tar")
            .args(["xzf"])
            .arg(&tgz)
            .current_dir(dest)
            .status()
            .expect("failed to run tar");
        if !extract_status.success() {
            panic!("tar failed to extract ONNX Runtime archive");
        }
        let _ = std::fs::remove_file(&tgz);
    }
}

fn find_file_recursive(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok().into_iter().flatten() {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, name) {
                return Some(found);
            }
        } else if path.file_name().is_some_and(|n| n == name) {
            return Some(path);
        }
    }
    None
}

fn list_dir_recursive(dir: &Path, depth: usize) -> String {
    let mut result = String::new();
    let indent = "  ".repeat(depth);
    for entry in std::fs::read_dir(dir).ok().into_iter().flatten() {
        let entry = entry.ok().unwrap();
        let path = entry.path();
        if path.is_dir() {
            result.push_str(&format!(
                "{indent}{}/\n",
                path.file_name().unwrap().to_string_lossy()
            ));
            result.push_str(&list_dir_recursive(&path, depth + 1));
        } else {
            result.push_str(&format!(
                "{indent}{}\n",
                path.file_name().unwrap().to_string_lossy()
            ));
        }
    }
    result
}

fn main() {
    let target = std::env::var("TARGET").expect("TARGET missing");
    let lib_name = library_name(&target);

    let staged_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"),
    )
    .join("target/onnxruntime");
    std::fs::create_dir_all(&staged_dir).expect("failed to create ONNX Runtime resource directory");

    let staged_lib = staged_dir.join(lib_name);
    if staged_lib.exists() {
        tauri_build::build();
        return;
    }

    if let Some(source) = find_library(lib_name, &target) {
        println!(
            "cargo:warning=staging ONNX Runtime from {}",
            source.display()
        );
        std::fs::copy(&source, &staged_lib).unwrap_or_else(|e| {
            panic!(
                "failed to stage ONNX Runtime from {}: {e}",
                source.display()
            )
        });
        tauri_build::build();
        return;
    }

    let (url, is_zip) = ort_download_url(&target).unwrap_or_else(|| {
        panic!(
            "no prebuilt ONNX Runtime available for target `{target}`.\n\
             Set ORT_LIB_LOCATION to the directory containing {lib_name}."
        );
    });

    println!(
        "cargo:warning=downloading ONNX Runtime {ORT_VERSION} for {target}..."
    );
    let download_dir = staged_dir.join("download");
    std::fs::create_dir_all(&download_dir).expect("failed to create download directory");
    download_and_extract(url, is_zip, &download_dir);

    if let Some(found) = find_file_recursive(&download_dir, lib_name) {
        std::fs::copy(&found, &staged_lib).unwrap_or_else(|e| {
            panic!("failed to stage downloaded ONNX Runtime: {e}")
        });
    } else {
        panic!(
            "downloaded ONNX Runtime archive does not contain {lib_name}.\n\
             Archive contents:\n{}",
            list_dir_recursive(&download_dir, 0)
        );
    }

    let _ = std::fs::remove_dir_all(&download_dir);

    tauri_build::build();
}
