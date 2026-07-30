//! Cheap vendor CLI status probes.

use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use ts_rs::TS;

const OUTPUT_LIMIT: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "kebab-case")]
#[ts(export)]
pub enum AuthenticationState {
    LoggedIn,
    LoggedOut,
    ConfigInvalid { diagnostic: String },
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeOutput {
    pub exit_code: i32,
    pub stderr: String,
}

#[must_use]
pub fn classify_auth_exit(exit_code: i32, stderr: &str) -> AuthenticationState {
    if exit_code == 0 {
        return AuthenticationState::LoggedIn;
    }

    let lower = stderr.to_ascii_lowercase();
    let codex_config =
        lower.contains("error loading configuration") && lower.contains("unknown variant");
    let claude_config = (lower.contains("error parsing") || lower.contains("failed to parse"))
        && lower.contains("settings.json");

    if codex_config || claude_config {
        AuthenticationState::ConfigInvalid {
            diagnostic: crate::acp::error::AcpError::excerpt(stderr),
        }
    } else {
        AuthenticationState::LoggedOut
    }
}

pub fn run_auth_probe(
    executable: &Path,
    args: &[&str],
    augmented_path: Option<&OsStr>,
    timeout: Duration,
) -> Result<AuthenticationState, String> {
    let output = run_exit_probe(executable, args, augmented_path, timeout)?;
    Ok(classify_auth_exit(output.exit_code, &output.stderr))
}

pub fn run_exit_probe(
    executable: &Path,
    args: &[&str],
    augmented_path: Option<&OsStr>,
    timeout: Duration,
) -> Result<ProbeOutput, String> {
    let nonce = uuid::Uuid::new_v4();
    let stdout_path = std::env::temp_dir().join(format!("poly-probe-{nonce}.out"));
    let stderr_path = std::env::temp_dir().join(format!("poly-probe-{nonce}.err"));
    let mut stdout = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&stdout_path)
        .map_err(|error| error.to_string())?;
    let mut stderr = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&stderr_path)
        .map_err(|error| error.to_string())?;

    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            stdout.try_clone().map_err(|error| error.to_string())?,
        ))
        .stderr(Stdio::from(
            stderr.try_clone().map_err(|error| error.to_string())?,
        ));
    if let Some(path) = augmented_path {
        command.env("PATH", path);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(stdout_path);
                let _ = std::fs::remove_file(stderr_path);
                return Err("status probe timed out".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(error.to_string()),
        }
    };

    // Read only after immediate child exits. Regular files return at current
    // size even when a forked descendant inherited their descriptors.
    stdout
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    stderr
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut ignored_stdout = Vec::new();
    let mut stderr_bytes = Vec::new();
    stdout
        .take(OUTPUT_LIMIT)
        .read_to_end(&mut ignored_stdout)
        .map_err(|error| error.to_string())?;
    stderr
        .take(OUTPUT_LIMIT)
        .read_to_end(&mut stderr_bytes)
        .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(stdout_path);
    let _ = std::fs::remove_file(stderr_path);

    Ok(ProbeOutput {
        exit_code: status.code().unwrap_or(-1),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
    })
}
