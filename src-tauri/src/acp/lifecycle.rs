//! Child-process ownership: the part the SDK does not cover.
//!
//! The SDK's `AcpAgent` will spawn *and* drive a connection for you, and its
//! `ChildGuard` kills the process group on drop — but that group kill is
//! `#[cfg(unix)]` only. On Windows it degrades to `TerminateProcess` on the
//! immediate child, which for `npx → node → agent` kills the launcher and
//! orphans the agent.
//!
//! So this module takes the child itself. `AcpAgent::spawn_process` is public
//! for exactly this: it hands back piped stdio plus the `Child`, and we supply
//! the transport to the SDK via `ByteStreams`. Protocol, framing, and transport
//! remain the SDK's; only process ownership is ours.
//!
//! On Windows the child is assigned to a Job Object with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so the whole tree dies when the handle
//! closes — including grandchildren, and including the case where Poly UI exits
//! without running destructors.

use super::error::AcpError;
use agent_client_protocol::AcpAgentConfig;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long to wait after a polite termination before forcing.
pub const TERMINATION_GRACE: Duration = Duration::from_millis(1_500);

/// Bounded stderr kept for diagnostics. Matches the SDK's own limit.
const STDERR_LIMIT: usize = 64 * 1024;

/// How a child ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildOutcome {
    /// Exited on its own with this code.
    Exited(i32),
    /// Did not exit within [`TERMINATION_GRACE`] and was killed.
    Forced,
    /// Already gone when we looked.
    AlreadyGone,
}

/// Options for launching an agent.
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    /// Absolute path to the executable. Never a shell string.
    pub executable: PathBuf,
    /// Arguments as an array. Never concatenated into a command line.
    pub args: Vec<String>,
    /// Working directory. Required: an agent with no workspace is a bug, and
    /// defaulting to the app's own directory would point it at Poly UI.
    pub working_directory: PathBuf,
    /// Environment for the child. Applied on top of the inherited environment.
    pub env: Vec<(String, String)>,
}

impl LaunchOptions {
    /// Build the SDK's launch configuration.
    ///
    /// Structured throughout: `AcpAgentConfig` takes a path and an argument
    /// vector, so there is no point at which a value could be interpreted by a
    /// shell.
    #[must_use]
    pub fn to_config(&self) -> AcpAgentConfig {
        let augmented_path = crate::acp::resolve::augmented_path();
        let mut config = AcpAgentConfig::new(self.executable.clone())
            .env("PATH", augmented_path.to_string_lossy());
        for arg in &self.args {
            config = config.arg(arg.clone());
        }
        for (name, value) in &self.env {
            if std::env::var_os(name).is_none() {
                config = config.env(name.clone(), value.clone());
            }
        }
        config
    }
}

/// A bounded ring of the child's stderr.
///
/// stderr is diagnostics only and never protocol — it is captured separately
/// from stdout and never parsed.
#[derive(Debug, Default)]
pub struct StderrTail {
    buffer: Mutex<String>,
}

impl StderrTail {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(StderrTail::default())
    }

    /// Append a line, discarding from the front once the cap is reached.
    pub fn push_line(&self, line: &str) {
        let mut buffer = self.buffer.lock().expect("stderr tail lock");
        buffer.push_str(line);
        buffer.push('\n');
        if buffer.len() > STDERR_LIMIT {
            // Keep the tail: the last thing said before a crash is the useful
            // part. Trim on a char boundary so the buffer stays valid UTF-8.
            let excess = buffer.len() - STDERR_LIMIT;
            let mut cut = excess;
            while cut < buffer.len() && !buffer.is_char_boundary(cut) {
                cut += 1;
            }
            let kept = buffer.split_off(cut);
            *buffer = kept;
        }
    }

    /// A snapshot for an error message, or `None` if nothing was written.
    #[must_use]
    pub fn snapshot(&self) -> Option<String> {
        let buffer = self.buffer.lock().expect("stderr tail lock");
        let trimmed = buffer.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }
}

/// Owns a spawned agent process and guarantees it dies.
///
/// Termination escalates: a polite request first, then a hard kill once
/// [`TERMINATION_GRACE`] has elapsed. `Drop` forces immediately, because a drop
/// happens on paths where nobody is left to wait.
pub struct OwnedChild {
    child: Option<async_process::Child>,
    pid: u32,
    receipt_path: Option<PathBuf>,
    #[cfg(windows)]
    job: Option<windows_job::JobObject>,
}

impl std::fmt::Debug for OwnedChild {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OwnedChild")
            .field("pid", &self.pid)
            .finish()
    }
}

impl OwnedChild {
    /// Adopt a freshly spawned child.
    pub fn adopt(
        child: async_process::Child,
        executable: &std::path::Path,
    ) -> Result<Self, AcpError> {
        let pid = child.id();
        let receipt_path = write_pid_receipt(pid, executable)
            .map(Some)
            .unwrap_or_else(|error| {
                log::warn!("could not write PID receipt for agent {pid}: {error}");
                None
            });

        #[cfg(windows)]
        let job = match windows_job::JobObject::assign(pid) {
            Ok(job) => Some(job),
            Err(error) => {
                // A failed job assignment is not fatal — the direct child is
                // still killable — but it does mean grandchildren could be
                // orphaned, so it must be visible.
                log::warn!(
                    "could not assign agent process {pid} to a job object; \
                     grandchildren may survive termination: {error}"
                );
                None
            }
        };

        Ok(OwnedChild {
            child: Some(child),
            pid,
            receipt_path,
            #[cfg(windows)]
            job,
        })
    }

    #[must_use]
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Has the child already exited?
    pub fn try_exit_code(&mut self) -> Option<i32> {
        let child = self.child.as_mut()?;
        match child.try_status() {
            Ok(Some(status)) => Some(exit_code(status)),
            _ => None,
        }
    }

    /// Terminate, escalating from polite to forced within a bounded wait.
    pub async fn terminate(&mut self) -> ChildOutcome {
        self.remove_receipt();
        let Some(mut child) = self.child.take() else {
            return ChildOutcome::AlreadyGone;
        };

        if let Ok(Some(status)) = child.try_status() {
            return ChildOutcome::Exited(exit_code(status));
        }

        request_graceful_stop(self.pid);

        // Bounded wait. A child that ignores the polite request gets killed.
        let deadline = async_io::Timer::after(TERMINATION_GRACE);
        let waited = futures::future::select(Box::pin(child.status()), deadline).await;

        match waited {
            futures::future::Either::Left((Ok(status), _)) => {
                ChildOutcome::Exited(exit_code(status))
            }
            futures::future::Either::Left((Err(_), _)) => ChildOutcome::AlreadyGone,
            futures::future::Either::Right(_) => {
                force_kill(self.pid, &mut child);
                #[cfg(windows)]
                self.job.take();
                let _ = child.status().await;
                ChildOutcome::Forced
            }
        }
    }

    /// Kill immediately, without waiting. Used on drop and on app exit, where
    /// there is no opportunity to await.
    pub fn force_now(&mut self) {
        if let Some(child) = self.child.as_mut() {
            force_kill(self.pid, child);
        }
        #[cfg(windows)]
        self.job.take();
        self.remove_receipt();
    }

    fn remove_receipt(&mut self) {
        if let Some(path) = self.receipt_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        // Poly UI calls `std::process::exit` on ExitRequested (see lib.rs), so
        // this does not run on app exit — the host's explicit shutdown does.
        // It still covers every other path: an error return, a panic, a task
        // being cancelled.
        self.force_now();
    }
}

fn exit_code(status: std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(-1)
}

/// Ask the process tree to stop.
#[cfg(unix)]
fn request_graceful_stop(pid: u32) {
    // The child leads its own process group (the SDK's `spawn_process` sets
    // `process_group(0)`), so signalling the group reaches wrapper launchers
    // like `npx → node`.
    if let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) {
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::TERM);
    }
}

#[cfg(not(unix))]
fn request_graceful_stop(_pid: u32) {
    // Windows has no portable graceful stop for a child without a shared
    // console. Closing stdin is the polite signal, and that has already
    // happened by the time termination is requested; the job object handles the
    // rest.
}

#[cfg(unix)]
fn force_kill(pid: u32, child: &mut async_process::Child) {
    if let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) {
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
    }
    let _ = child.kill();
}

#[cfg(not(unix))]
fn force_kill(_pid: u32, child: &mut async_process::Child) {
    // Dropping the job object handle is what kills the tree; `kill` covers the
    // case where the job could not be created.
    let _ = child.kill();
}

#[derive(Debug, Serialize, Deserialize)]
struct PidReceipt {
    pid: u32,
    executable: PathBuf,
    instance_id: String,
}

fn receipt_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("polyui")
        .join("acp-pids")
}

fn write_pid_receipt(pid: u32, executable: &std::path::Path) -> std::io::Result<PathBuf> {
    write_pid_receipt_in(&receipt_dir(), pid, executable)
}

fn write_pid_receipt_in(
    directory: &std::path::Path,
    pid: u32,
    executable: &std::path::Path,
) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(directory)?;
    let receipt = PidReceipt {
        pid,
        executable: executable.to_path_buf(),
        instance_id: uuid::Uuid::new_v4().to_string(),
    };
    let path = directory.join(format!("{}.json", receipt.instance_id));
    std::fs::write(
        &path,
        serde_json::to_vec(&receipt).map_err(std::io::Error::other)?,
    )?;
    Ok(path)
}

/// Sweep hard-crash leftovers before any new agent starts.
pub fn sweep_pid_receipts() {
    sweep_pid_receipts_in(&receipt_dir());
}

fn sweep_pid_receipts_in(directory: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let receipt = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<PidReceipt>(&bytes).ok());
        let Some(receipt) = receipt else {
            let _ = std::fs::remove_file(path);
            continue;
        };
        if known_agent_binary(&receipt.executable) && process_matches(&receipt) {
            terminate_orphan(receipt.pid);
        }
        let _ = std::fs::remove_file(path);
    }
}

fn known_agent_binary(executable: &std::path::Path) -> bool {
    executable
        .file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|name| matches!(name, "codex-acp" | "claude-agent-acp" | "claude-code-acp"))
}

#[cfg(target_os = "linux")]
fn process_matches(receipt: &PidReceipt) -> bool {
    let Ok(command) = std::fs::read(format!("/proc/{}/cmdline", receipt.pid)) else {
        return false;
    };
    let expected = receipt.executable.as_os_str().as_encoded_bytes();
    command
        .split(|byte| *byte == 0)
        .any(|argument| argument == expected)
}

#[cfg(target_os = "macos")]
fn process_matches(receipt: &PidReceipt) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let mut buffer = [0_u8; 4096];
    // SAFETY: `buffer` is writable for its full reported size; proc_pidpath
    // returns the number of initialized bytes or <= 0 on failure.
    let length = unsafe {
        libc::proc_pidpath(
            receipt.pid.cast_signed(),
            buffer.as_mut_ptr().cast(),
            u32::try_from(buffer.len()).unwrap_or(u32::MAX),
        )
    };
    length > 0
        && std::ffi::OsStr::from_bytes(&buffer[..usize::try_from(length).unwrap_or(0)])
            == receipt.executable.as_os_str()
}

#[cfg(windows)]
fn process_matches(_receipt: &PidReceipt) -> bool {
    // The kill-on-close Job Object already removed every process from a
    // crashed instance. A leftover receipt is stale and is deleted above.
    false
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn process_matches(_receipt: &PidReceipt) -> bool {
    false
}

#[cfg(unix)]
fn terminate_orphan(pid: u32) {
    let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) else {
        return;
    };
    let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::TERM);
    std::thread::sleep(Duration::from_millis(150));
    let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
}

#[cfg(not(unix))]
fn terminate_orphan(_pid: u32) {}

/// Windows Job Object support.
///
/// A job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` kills every process in it
/// when the last handle closes. Assigning the agent to one means the whole tree
/// dies with Poly UI even on paths where no destructor runs.
#[cfg(windows)]
mod windows_job {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Owns a job handle. Dropping it kills every process still in the job.
    pub struct JobObject(HANDLE);

    // A raw HANDLE is just a value; the OS owns the object it names.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        /// Create a kill-on-close job and put `pid` in it.
        pub fn assign(pid: u32) -> Result<Self, std::io::Error> {
            // SAFETY: every call below is a documented Win32 entry point, and
            // each returned handle is checked before use and closed exactly
            // once — the process handle here, the job handle in `Drop`.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Err(std::io::Error::last_os_error());
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(info).cast(),
                    u32::try_from(std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                        .unwrap_or(0),
                ) == 0
                {
                    let error = std::io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(error);
                }

                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() || process == INVALID_HANDLE_VALUE {
                    let error = std::io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(error);
                }

                let assigned = AssignProcessToJobObject(job, process);
                CloseHandle(process);
                if assigned == 0 {
                    let error = std::io::Error::last_os_error();
                    CloseHandle(job);
                    return Err(error);
                }

                Ok(JobObject(job))
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            // Closing the last handle terminates every process in the job.
            // SAFETY: `self.0` is a live handle created in `assign` and closed
            // exactly once, here.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_options_build_a_structured_config() {
        let options = LaunchOptions {
            executable: PathBuf::from("/opt/My Tools/agent"),
            args: vec!["--serve".into(), "--flag=value with spaces".into()],
            working_directory: PathBuf::from("/home/theo/My Project"),
            env: vec![("NO_BROWSER".into(), "1".into())],
        };
        let config = options.to_config();

        assert_eq!(config.command(), PathBuf::from("/opt/My Tools/agent"));
        // Arguments stay separate; nothing was concatenated or quoted.
        assert_eq!(config.arguments(), ["--serve", "--flag=value with spaces"]);
        assert_eq!(
            config.environment().get("NO_BROWSER").map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn parent_environment_wins_over_runtime_configuration() {
        let options = LaunchOptions {
            executable: PathBuf::from("/bin/agent"),
            args: vec![],
            working_directory: PathBuf::from("/tmp"),
            env: vec![("PATH".into(), "/wrong".into())],
        };

        assert_ne!(
            options
                .to_config()
                .environment()
                .get("PATH")
                .map(String::as_str),
            Some("/wrong")
        );
    }

    #[test]
    fn stderr_tail_is_bounded_and_keeps_the_end() {
        let tail = StderrTail::new();
        assert_eq!(tail.snapshot(), None);

        for index in 0..20_000 {
            tail.push_line(&format!("line {index} with some padding to add bulk"));
        }

        let snapshot = tail.snapshot().expect("some output");
        assert!(snapshot.len() <= STDERR_LIMIT, "{}", snapshot.len());
        // The most recent output survives; the oldest is what gets dropped.
        assert!(snapshot.contains("line 19999"), "tail must keep the end");
        assert!(!snapshot.contains("line 0 with"), "head should be dropped");
    }

    #[test]
    fn stderr_tail_stays_valid_utf8_when_trimmed() {
        let tail = StderrTail::new();
        for _ in 0..5_000 {
            // Multi-byte characters straddling the cut point must not corrupt.
            tail.push_line(&"é".repeat(64));
        }
        let snapshot = tail.snapshot().expect("some output");
        assert!(snapshot.len() <= STDERR_LIMIT);
        assert!(snapshot.chars().all(|c| c == 'é' || c == '\n'));
    }

    #[test]
    fn pid_receipts_are_written_and_swept_on_the_next_startup() {
        let directory =
            std::env::temp_dir().join(format!("poly-pid-receipts-{}", uuid::Uuid::new_v4()));
        let path =
            write_pid_receipt_in(&directory, u32::MAX, std::path::Path::new("/tmp/codex-acp"))
                .unwrap();
        assert!(path.is_file());

        sweep_pid_receipts_in(&directory);

        assert!(!path.exists());
        let _ = std::fs::remove_dir(directory);
    }
}
