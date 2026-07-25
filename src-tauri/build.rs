use std::path::{Path, PathBuf};
use std::process::Command;

const ORT_VERSION: &str = "1.24.2";
const RETAINED_CEF_LOCALE: &str = "en-US.pak";
const UNUSED_CEF_RELEASE_FILES: [&str; 3] = ["CMakeLists.txt", "CREDITS.html", "archive.json"];

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

/// Linker flags the CEF OSR spike needs on the final binary only.
///
/// These use `rustc-link-arg-bins` rather than `rustflags` in
/// `.cargo/config.toml` on purpose: rustflags apply to every crate in the
/// graph, including build scripts and proc macros, which are linked from a
/// different working directory and have no reason to carry either flag.
fn emit_cef_link_args() {
    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"),
    );

    // cef-dll-sys copies libcef.so next to the binary but never tells the
    // linker to look there, so the binary dies at startup with
    // "libcef.so: cannot open shared object file". $ORIGIN resolves to the
    // binary's own directory at load time (dev builds); the ../lib entry
    // resolves the installed layout, where the binary sits in usr/bin and the
    // bundled CEF runtime in usr/lib/PolyUI (deb, rpm, and AppImage AppDir all
    // share that shape).
    println!("cargo::rustc-link-arg-bins=-Wl,-rpath,$ORIGIN:$ORIGIN/../lib/PolyUI");

    // Keep the executable's bundled SQLite (sqlx -> libsqlite3-sys) out of the
    // dynamic symbol table, so it stops interposing over the system
    // libsqlite3.so that WebKitGTK and CEF's NSS both use. Without this, CEF's
    // NSS init dies on a null function pointer. See hide-bundled-sqlite.map.
    let version_script = manifest_dir.join("hide-bundled-sqlite.map");
    println!("cargo::rerun-if-changed={}", version_script.display());
    println!(
        "cargo::rustc-link-arg-bins=-Wl,--version-script={}",
        version_script.display()
    );
}

fn optimize_cef_release_runtime(target: &str) {
    let profile = std::env::var("PROFILE").expect("PROFILE missing");
    if profile != "release" {
        return;
    }

    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .expect("Cargo profile directory missing");

    // Only ELF carries strippable debug symbols; the Windows libcef.dll ships
    // its symbols in a separate .pdb that is never bundled.
    if target.contains("linux") {
        let libcef = profile_dir.join("libcef.so");
        if !libcef.exists() {
            panic!("CEF runtime missing at {}", libcef.display());
        }

        let status = Command::new("strip")
            .arg("--strip-unneeded")
            .arg(&libcef)
            .status()
            .expect("failed to run strip on the CEF runtime");
        if !status.success() {
            panic!("strip failed for {}", libcef.display());
        }
    }

    let locales = profile_dir.join("locales");
    for entry in std::fs::read_dir(&locales)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", locales.display()))
    {
        let entry = entry.unwrap_or_else(|error| panic!("failed to read CEF locale: {error}"));
        if entry.file_name() != RETAINED_CEF_LOCALE {
            std::fs::remove_file(entry.path()).unwrap_or_else(|error| {
                panic!("failed to remove {}: {error}", entry.path().display())
            });
        }
    }

    for file_name in UNUSED_CEF_RELEASE_FILES {
        let path = profile_dir.join(file_name);
        if path.exists() {
            std::fs::remove_file(&path)
                .unwrap_or_else(|error| panic!("failed to remove {}: {error}", path.display()));
        }
    }
}

fn main() {
    println!("cargo::rerun-if-env-changed=CEF_PATH");
    let target = std::env::var("TARGET").expect("TARGET missing");
    let lib_name = library_name(&target);

    // Keyed off TARGET, not cfg!(target_os), because cfg in a build script
    // describes the host that is running it, not what is being built.
    //
    // `cef` gates every CEF-dependent item in the crate. macOS is excluded: it
    // needs separate helper .app bundles inside the framework directory rather
    // than re-executing this binary, which the bundler does not produce.
    println!("cargo::rustc-check-cfg=cfg(cef)");
    if target.contains("linux") || target.contains("windows") {
        println!("cargo::rustc-cfg=cef");
        // Only ELF needs the rpath and symbol-visibility fixes; on Windows the
        // loader already searches the executable's own directory.
        if target.contains("linux") {
            emit_cef_link_args();
        }
        optimize_cef_release_runtime(&target);
    }

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
