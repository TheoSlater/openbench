use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const NAME: &str = "polyui-ai-runtime";

pub struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    pid: u32,
}

impl SidecarProcess {
    pub async fn spawn(path: &Path) -> Result<(Self, BufReader<ChildStdout>), String> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Sidecar diagnostics can contain provider/CLI payloads. Protocol
            // errors are returned on stdout after redaction; discard raw stderr.
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start AI runtime: {error}"))?;
        let pid = child.id().ok_or_else(|| "AI runtime has no process id".to_string())?;
        let stdin = child.stdin.take().ok_or_else(|| "AI runtime stdin unavailable".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "AI runtime stdout unavailable".to_string())?;
        Ok((SidecarProcess { child, stdin, pid }, BufReader::new(stdout)))
    }

    pub async fn write(&mut self, value: &serde_json::Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("AI runtime write failed: {error}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| format!("AI runtime flush failed: {error}"))
    }

    pub async fn terminate(mut self) {
        let _ = self.write(&serde_json::json!({ "type": "shutdown" })).await;
        if tokio::time::timeout(Duration::from_millis(1_500), self.child.wait())
            .await
            .is_ok()
        {
            return;
        }
        #[cfg(unix)]
        if let Some(pid) = rustix::process::Pid::from_raw(self.pid.cast_signed()) {
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

pub fn resolve_executable(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("POLYUI_AI_SIDECAR_PATH") {
        return validate(PathBuf::from(path));
    }
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let plain_name = format!("{NAME}{extension}");
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    if let Some(parent) = current.parent() {
        let candidate = parent.join(&plain_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        let candidate = resources.join(&plain_name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    if cfg!(debug_assertions) {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let mut matches = std::fs::read_dir(&directory)
            .map_err(|error| format!("AI runtime binary directory unavailable: {error}"))?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&format!("{NAME}-")))
            });
        if let Some(path) = matches.next() {
            return validate(path);
        }
    }
    Err("bundled AI runtime executable was not found".into())
}

fn validate(path: PathBuf) -> Result<PathBuf, String> {
    if path.is_absolute() && path.is_file() {
        Ok(path)
    } else {
        Err("AI runtime executable path is not an absolute file".into())
    }
}
