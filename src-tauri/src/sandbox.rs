use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const MAX_COMMAND_LENGTH: usize = 2_000;
const MAX_COMMAND_TOKENS: usize = 16;
const MAX_SESSION_ID_LENGTH: usize = 200;
const MAX_WORKSPACE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const ORPHAN_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const IDLE_TTL: Duration = Duration::from_secs(30 * 60);
const REAPER_INTERVAL: Duration = Duration::from_secs(60);
const HEADLESS_NETWORK_POLICY: &str = "none; fixed read-only allowlist";

#[derive(Clone)]
pub struct SandboxManager {
    app: AppHandle,
    state: Arc<Mutex<ManagerState>>,
}

struct ManagerState {
    sessions: HashMap<String, HeadlessSession>,
}

struct HeadlessSession {
    root: PathBuf,
    last_activity: Instant,
    active_commands: u32,
}

#[derive(Clone, Debug)]
pub struct SandboxCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxDiagnostics {
    pub sandbox_id: String,
    pub state: &'static str,
    pub runtime: &'static str,
    pub capabilities: Vec<String>,
    pub workspace_bytes: u64,
    pub workspace_limit_bytes: u64,
    pub network_policy: &'static str,
    pub active_commands: u32,
    pub last_activity_age_ms: u64,
}

impl SandboxManager {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        reap_headless_workspaces();
        let manager = Self {
            app: app.clone(),
            state: Arc::new(Mutex::new(ManagerState {
                sessions: HashMap::new(),
            })),
        };
        manager.start_reaper();
        Ok(manager)
    }

    pub fn spawn_command(
        &self,
        sandbox_id: &str,
        command: &str,
        cwd: Option<&str>,
        status: &dyn Fn(&str),
    ) -> Result<SandboxCommand, String> {
        validate_session_id(sandbox_id)?;
        if command.trim().is_empty() || command.len() > MAX_COMMAND_LENGTH {
            return Err(blocked("command must be between 1 and 2000 characters"));
        }
        let cwd = normalize_cwd(cwd)?;
        status("Checking host command policy…");

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if state.sessions.contains_key(sandbox_id) {
            let session = state.sessions.get_mut(sandbox_id).expect("session present");
            return prepare_command(session, &cwd, command, status);
        }

        let mut session = create_headless_session()?;
        let plan = match prepare_command(&mut session, &cwd, command, status) {
            Ok(plan) => plan,
            Err(error) => {
                let _ = cleanup_headless_session(session);
                return Err(error);
            }
        };
        state.sessions.insert(sandbox_id.to_string(), session);
        Ok(plan)
    }

    pub fn command_started(&self, sandbox_id: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let session = state
            .sessions
            .get_mut(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        session.active_commands = session.active_commands.saturating_add(1);
        touch_session(session);
        Ok(())
    }

    pub fn command_finished(&self, sandbox_id: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let session = state
            .sessions
            .get_mut(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        session.active_commands = session.active_commands.saturating_sub(1);
        touch_session(session);
        Ok(())
    }

    pub fn workspace_limit_reached(&self, sandbox_id: &str) -> Result<bool, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let session = state
            .sessions
            .get(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        workspace_size(&session.root, MAX_WORKSPACE_BYTES)
            .map(|size| size > MAX_WORKSPACE_BYTES)
            .map_err(|error| format!("sandbox workspace size unavailable: {error}"))
    }

    pub fn diagnostics(&self, sandbox_id: &str) -> Result<SandboxDiagnostics, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let session = state
            .sessions
            .get(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        let workspace_bytes = workspace_size(&session.root, MAX_WORKSPACE_BYTES)
            .map_err(|error| format!("sandbox workspace size unavailable: {error}"))?;
        Ok(SandboxDiagnostics {
            sandbox_id: sandbox_id.to_string(),
            state: "ready",
            runtime: "host-restricted",
            capabilities: vec!["read-only".into()],
            workspace_bytes,
            workspace_limit_bytes: MAX_WORKSPACE_BYTES,
            network_policy: HEADLESS_NETWORK_POLICY,
            active_commands: session.active_commands,
            last_activity_age_ms: session.last_activity.elapsed().as_millis() as u64,
        })
    }

    pub fn stop_processes(&self, sandbox_id: &str) -> Result<(), String> {
        validate_session_id(sandbox_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let session = state
            .sessions
            .get_mut(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        touch_session(session);
        Ok(())
    }

    pub fn destroy(&self, sandbox_id: &str) -> Result<(), String> {
        validate_session_id(sandbox_id)?;
        let session = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?
            .sessions
            .remove(sandbox_id);
        if let Some(session) = session {
            cleanup_headless_session(session)?;
            let _ = self.app.emit("sandbox-destroyed", sandbox_id);
        }
        Ok(())
    }

    pub fn destroy_all(&self) -> Result<(), String> {
        let sessions = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
            std::mem::take(&mut state.sessions)
        };
        let mut first_error = None;
        for (sandbox_id, session) in sessions {
            if let Err(error) = cleanup_headless_session(session) {
                first_error.get_or_insert(error);
            }
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
        }
        first_error.map_or(Ok(()), Err)
    }

    fn start_reaper(&self) {
        let manager = self.clone();
        thread::spawn(move || loop {
            thread::sleep(REAPER_INTERVAL);
            manager.reap_idle();
        });
    }

    fn reap_idle(&self) {
        let expired = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            let ids: Vec<_> = state
                .sessions
                .iter()
                .filter(|(_, session)| should_reap_session(session))
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| state.sessions.remove(&id).map(|session| (id, session)))
                .collect::<Vec<_>>()
        };
        for (sandbox_id, session) in expired {
            if let Err(error) = cleanup_headless_session(session) {
                crate::startup_log::log_error(format!(
                    "idle host workspace cleanup failed for {sandbox_id}: {error}"
                ));
            }
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
        }
    }
}

fn prepare_command(
    session: &mut HeadlessSession,
    cwd: &str,
    command: &str,
    status: &dyn Fn(&str),
) -> Result<SandboxCommand, String> {
    ensure_headless_workspace_room(session)?;
    let plan = headless_command(session, cwd, command)?;
    touch_session(session);
    status("Using host-restricted runner…");
    Ok(plan)
}

fn create_headless_session() -> Result<HeadlessSession, String> {
    let token = Uuid::new_v4().simple().to_string();
    let root = std::env::temp_dir().join(format!("polyui-headless-{token}"));
    let result = (|| {
        fs::create_dir(&root).map_err(|error| format!("host workspace unavailable: {error}"))?;
        set_private_permissions(&root)?;
        for directory in [
            root.join("workspace"),
            root.join("home/sandbox"),
            root.join("tmp"),
        ] {
            fs::create_dir_all(&directory)
                .map_err(|error| format!("host workspace unavailable: {error}"))?;
            set_private_permissions(&directory)?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&root);
        return Err(error);
    }
    Ok(HeadlessSession {
        root,
        last_activity: Instant::now(),
        active_commands: 0,
    })
}

fn cleanup_headless_session(session: HeadlessSession) -> Result<(), String> {
    match fs::remove_dir_all(&session.root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("host workspace cleanup failed: {error}")),
    }
}

fn ensure_headless_workspace_room(session: &HeadlessSession) -> Result<(), String> {
    let size = workspace_size(&session.root, MAX_WORKSPACE_BYTES)
        .map_err(|error| format!("host workspace size unavailable: {error}"))?;
    if size > MAX_WORKSPACE_BYTES {
        return Err("Host workspace limit reached (8 GiB). Reset the sandbox to continue.".into());
    }
    Ok(())
}

fn touch_session(session: &mut HeadlessSession) {
    session.last_activity = Instant::now();
}

fn should_reap_session(session: &HeadlessSession) -> bool {
    session.active_commands == 0 && session.last_activity.elapsed() >= IDLE_TTL
}

fn workspace_size(root: &Path, limit: u64) -> io::Result<u64> {
    let mut pending = vec![root.to_path_buf()];
    let mut total = 0_u64;
    while let Some(path) = pending.pop() {
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            pending.extend(
                fs::read_dir(path)?
                    .filter_map(Result::ok)
                    .map(|entry| entry.path()),
            );
        } else {
            total = total.saturating_add(metadata.len());
            if total > limit {
                return Ok(total);
            }
        }
    }
    Ok(total)
}

fn headless_command(
    session: &HeadlessSession,
    cwd: &str,
    command: &str,
) -> Result<SandboxCommand, String> {
    let tokens = headless_tokens(command)
        .ok_or_else(|| blocked("shell syntax or invalid characters are not allowed"))?;
    if !headless_shape(&tokens) {
        return Err(blocked("program or arguments are not allowlisted"));
    }
    let name = tokens.first().map(String::as_str).unwrap_or_default();
    let program = headless_program(name)
        .ok_or_else(|| blocked("approved executable is not installed in a trusted location"))?;
    let physical_cwd = headless_cwd(session, cwd)
        .ok_or_else(|| blocked("working directory is outside the host workspace"))?;
    let args = match name {
        "pwd" if tokens.len() == 1 => vec!["%s\n".into(), cwd.into()],
        "true" | "false" if tokens.len() == 1 => vec![],
        "echo" | "printf" if tokens.len() <= 9 => tokens[1..].to_vec(),
        "node" | "python3" if tokens.len() == 2 && tokens[1] == "--version" => {
            vec!["--version".into()]
        }
        "git" if tokens.len() == 2 && tokens[1] == "--version" => vec!["--version".into()],
        "git"
            if (tokens.len() == 2 && tokens[1] == "status")
                || (tokens.len() == 3 && tokens[1] == "status" && tokens[2] == "--short") =>
        {
            tokens[1..].to_vec()
        }
        "ls" => headless_ls_args(session, cwd, &tokens[1..])?,
        "cat" | "head" | "tail" | "wc" => headless_file_args(session, cwd, &tokens[1..], true)?,
        "grep" | "rg" => headless_search_args(session, cwd, &tokens[1..])?,
        _ => return Err(blocked("program or arguments are not allowlisted")),
    };
    Ok(SandboxCommand {
        program,
        args,
        cwd: Some(physical_cwd),
        env: headless_environment(session),
    })
}

fn blocked(reason: &str) -> String {
    format!("Command blocked: {reason}")
}

fn headless_shape(tokens: &[String]) -> bool {
    let Some(name) = tokens.first() else {
        return false;
    };
    matches!(
        name.as_str(),
        "pwd"
            | "true"
            | "false"
            | "echo"
            | "printf"
            | "node"
            | "python3"
            | "git"
            | "ls"
            | "cat"
            | "head"
            | "tail"
            | "wc"
            | "grep"
            | "rg"
    ) && !name.contains('/')
        && !name.contains('\\')
}

fn headless_tokens(command: &str) -> Option<Vec<String>> {
    if command.is_empty()
        || command.chars().any(|character| {
            character.is_ascii_control() || ";|&><`$(){}[]*?\\'\"".contains(character)
        })
    {
        return None;
    }
    let tokens: Vec<_> = command.split_whitespace().map(ToOwned::to_owned).collect();
    (!tokens.is_empty() && tokens.len() <= MAX_COMMAND_TOKENS).then_some(tokens)
}

fn headless_program(name: &str) -> Option<PathBuf> {
    let name = match name {
        "pwd" => "printf",
        "true" | "false" | "echo" | "printf" | "node" | "python3" | "git" | "ls" | "cat"
        | "head" | "tail" | "wc" | "grep" | "rg" => name,
        _ => return None,
    };
    restricted_host_program(name)
}

fn restricted_host_program(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return None;
    }
    let names: Vec<&str> = if cfg!(windows) && name == "python3" {
        vec!["python3", "python"]
    } else {
        vec![name]
    };
    restricted_host_directories()
        .into_iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .flat_map(|path| {
            if cfg!(windows) {
                vec![path.clone(), path.with_extension("exe")]
            } else {
                vec![path]
            }
        })
        .find_map(|path| {
            let canonical = fs::canonicalize(&path).ok()?;
            let trusted = restricted_host_directories().into_iter().any(|directory| {
                fs::canonicalize(directory)
                    .map(|root| canonical.starts_with(root))
                    .unwrap_or(false)
            });
            let metadata = fs::metadata(&canonical).ok()?;
            (trusted && metadata.is_file() && executable(&metadata)).then_some(canonical)
        })
}

fn restricted_host_directories() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut directories = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                let root = PathBuf::from(root);
                directories.extend([root.join("Git/usr/bin"), root.join("nodejs")]);
            }
        }
        if let Some(root) = std::env::var_os("SystemRoot") {
            directories.push(PathBuf::from(root).join("System32"));
        }
        if let Some(path) = std::env::var_os("PATH") {
            directories.extend(
                std::env::split_paths(&path).filter(|directory| trusted_windows_path(directory)),
            );
        }
        directories
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ]
    }
}

#[cfg(windows)]
fn trusted_windows_path(path: &Path) -> bool {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    ["ProgramFiles", "ProgramFiles(x86)", "SystemRoot"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .any(|root| path.starts_with(root))
}

fn headless_ls_args(
    session: &HeadlessSession,
    cwd: &str,
    tokens: &[String],
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut path = None;
    for token in tokens {
        if token.starts_with('-') {
            if !matches!(
                token.as_str(),
                "-1" | "-l" | "-la" | "-al" | "--color=never"
            ) {
                return Err(blocked("ls option is not allowlisted"));
            }
            args.push(token.clone());
        } else if path.is_none() {
            path = Some(headless_path_arg(session, cwd, token)?);
        } else {
            return Err(blocked("ls accepts one path"));
        }
    }
    if let Some(path) = path {
        args.push(path);
    }
    Ok(args)
}

fn headless_file_args(
    session: &HeadlessSession,
    cwd: &str,
    tokens: &[String],
    require_path: bool,
) -> Result<Vec<String>, String> {
    if require_path && tokens.is_empty() {
        return Err(blocked("file command requires a path"));
    }
    tokens
        .iter()
        .map(|token| {
            if token.starts_with('-') {
                return Err(blocked("file command option is not allowlisted"));
            }
            headless_path_arg(session, cwd, token)
        })
        .collect()
}

fn headless_search_args(
    session: &HeadlessSession,
    cwd: &str,
    tokens: &[String],
) -> Result<Vec<String>, String> {
    let Some(pattern) = tokens.first() else {
        return Err(blocked("search requires a pattern"));
    };
    if pattern.starts_with('-') {
        return Err(blocked("search pattern cannot start with '-'"));
    }
    let mut args = vec![pattern.clone()];
    args.extend(headless_file_args(session, cwd, &tokens[1..], false)?);
    Ok(args)
}

fn headless_environment(session: &HeadlessSession) -> Vec<(String, String)> {
    let mut env = vec![
        (
            "HOME".into(),
            session.root.join("home/sandbox").display().to_string(),
        ),
        ("USER".into(), "sandbox".into()),
        ("LOGNAME".into(), "sandbox".into()),
        ("PATH".into(), restricted_host_path()),
        ("LANG".into(), "C".into()),
        ("LC_ALL".into(), "C".into()),
        (
            "TMPDIR".into(),
            session.root.join("tmp").display().to_string(),
        ),
        (
            "XDG_CONFIG_HOME".into(),
            session
                .root
                .join("home/sandbox/.config")
                .display()
                .to_string(),
        ),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        (
            "GIT_CEILING_DIRECTORIES".into(),
            session.root.display().to_string(),
        ),
        ("GIT_OPTIONAL_LOCKS".into(), "0".into()),
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
    ];
    #[cfg(windows)]
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        env.push((
            "SystemRoot".into(),
            system_root.to_string_lossy().into_owned(),
        ));
        env.push(("WINDIR".into(), system_root.to_string_lossy().into_owned()));
    }
    env
}

fn restricted_host_path() -> String {
    std::env::join_paths(restricted_host_directories())
        .map(|paths| paths.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            if cfg!(windows) {
                String::new()
            } else {
                "/usr/bin:/bin".into()
            }
        })
}

fn headless_cwd(session: &HeadlessSession, cwd: &str) -> Option<PathBuf> {
    let path = headless_physical_path(&session.root, Path::new(cwd))?;
    if !path.is_dir() || !path_is_inside(&session.root, &path) {
        return None;
    }
    fs::canonicalize(path).ok()
}

fn headless_path_arg(session: &HeadlessSession, cwd: &str, raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw == "-" || raw.contains('\0') || raw.starts_with('-') {
        return Err(blocked("path is not allowed"));
    }
    let path = Path::new(raw);
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(blocked("path cannot contain '..'"));
    }
    let virtual_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(cwd).join(path)
    };
    let Some(physical_path) = headless_physical_path(&session.root, &virtual_path) else {
        return Err(blocked("path must stay under the host workspace"));
    };
    if !path_is_inside(&session.root, &physical_path) {
        return Err(blocked("path resolves outside the host workspace"));
    }
    Ok(relative_virtual_path(Path::new(cwd), &virtual_path))
}

fn path_is_inside(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = fs::canonicalize(root) else {
        return false;
    };
    let mut probe = candidate.to_path_buf();
    loop {
        if let Ok(path) = fs::canonicalize(&probe) {
            return path.starts_with(&root);
        }
        let Some(parent) = probe.parent() else {
            return false;
        };
        if parent == probe {
            return false;
        }
        probe = parent.to_path_buf();
    }
}

fn headless_physical_path(root: &Path, path: &Path) -> Option<PathBuf> {
    for (virtual_root, physical_root) in [
        (Path::new("/workspace"), root.join("workspace")),
        (Path::new("/home/sandbox"), root.join("home/sandbox")),
        (Path::new("/tmp"), root.join("tmp")),
    ] {
        if path == virtual_root || path.starts_with(virtual_root) {
            return Some(physical_root.join(path.strip_prefix(virtual_root).ok()?));
        }
    }
    None
}

fn relative_virtual_path(base: &Path, target: &Path) -> String {
    let base: Vec<_> = base.components().collect();
    let target: Vec<_> = target.components().collect();
    let common = base
        .iter()
        .zip(&target)
        .take_while(|(left, right)| left == right)
        .count();
    let mut result: Vec<String> = (0..base.len().saturating_sub(common))
        .map(|_| "..".into())
        .collect();
    result.extend(
        target[common..]
            .iter()
            .map(|component| component.as_os_str().to_string_lossy().into_owned()),
    );
    if result.is_empty() {
        ".".into()
    } else {
        result.join("/")
    }
}

fn reap_headless_workspaces() {
    let root = std::env::temp_dir();
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_headless_workspace_name(name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else {
            continue;
        };
        if modified.elapsed().map_or(false, |age| age >= ORPHAN_TTL) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn is_headless_workspace_name(name: &str) -> bool {
    let Some(token) = name.strip_prefix("polyui-headless-") else {
        return false;
    };
    token.len() == 32 && token.chars().all(|character| character.is_ascii_hexdigit())
}

fn validate_session_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_SESSION_ID_LENGTH
        || value.contains('/')
        || value.contains('\\')
    {
        return Err("Invalid sandbox session id.".into());
    }
    Ok(())
}

pub fn normalize_cwd(cwd: Option<&str>) -> Result<String, String> {
    let raw = cwd.unwrap_or("/workspace").trim();
    if raw.is_empty() {
        return Ok("/workspace".into());
    }
    let path = Path::new(raw);
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Sandbox cwd cannot contain '..'.".into());
    }
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new("/workspace").join(path)
    };
    let allowed = [
        Path::new("/workspace"),
        Path::new("/home/sandbox"),
        Path::new("/tmp"),
    ];
    if allowed
        .iter()
        .any(|root| path == *root || path.starts_with(root))
    {
        Ok(path.to_string_lossy().replace('\\', "/"))
    } else {
        Err("Sandbox cwd must stay under /workspace, /home/sandbox, or /tmp.".into())
    }
}

fn executable(metadata: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return metadata.permissions().mode() & 0o111 != 0;
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        true
    }
}

fn set_private_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
pub fn sandbox_destroy(
    state: tauri::State<'_, crate::AppState>,
    sandbox_id: String,
) -> Result<(), String> {
    state.sandboxes.destroy(&sandbox_id)
}

#[tauri::command]
pub fn sandbox_stop_processes(
    state: tauri::State<'_, crate::AppState>,
    sandbox_id: String,
) -> Result<(), String> {
    state.sandboxes.stop_processes(&sandbox_id)
}

#[tauri::command]
pub fn sandbox_diagnostics(
    state: tauri::State<'_, crate::AppState>,
    sandbox_id: String,
) -> Result<SandboxDiagnostics, String> {
    state.sandboxes.diagnostics(&sandbox_id)
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_headless_session, headless_command, headless_program, headless_shape,
        headless_tokens, is_headless_workspace_name, normalize_cwd, path_is_inside,
        should_reap_session, workspace_size, HeadlessSession, IDLE_TTL,
    };
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn keeps_cwd_inside_sandbox() {
        assert_eq!(normalize_cwd(None).unwrap(), "/workspace");
        assert_eq!(normalize_cwd(Some("src")).unwrap(), "/workspace/src");
        assert!(normalize_cwd(Some("/home/user/project")).is_err());
        assert!(normalize_cwd(Some("../outside")).is_err());
    }

    #[test]
    fn headless_runner_allows_fixed_read_only_commands() {
        let session = super::create_headless_session().unwrap();
        std::fs::write(session.root.join("workspace/readme"), b"ok").unwrap();
        let canonical_root = std::fs::canonicalize(&session.root).unwrap();
        let result = (|| {
            for command in ["pwd", "echo hi", "ls -la", "cat readme", "node --version"] {
                assert!(headless_shape(&headless_tokens(command).unwrap()));
                let name = command.split_whitespace().next().unwrap();
                if headless_program(name).is_none() {
                    continue;
                }
                let plan = headless_command(&session, "/workspace", command)?;
                assert!(plan.cwd.as_ref().unwrap().starts_with(&canonical_root));
                assert!(plan
                    .env
                    .iter()
                    .all(|(key, _)| key != "POLYUI_API_KEY" && key != "OPENAI_API_KEY"));
            }
            Ok::<(), String>(())
        })();
        let cleanup = cleanup_headless_session(session);
        assert!(
            cleanup.is_ok(),
            "host workspace cleanup failed: {cleanup:?}"
        );
        result.unwrap();
    }

    #[test]
    fn blocks_shell_syntax_and_unsafe_programs() {
        let session = super::create_headless_session().unwrap();
        for command in [
            "sh -c whoami",
            "cat /etc/passwd",
            "cat ../outside",
            "rm file",
            "node -e print(1)",
            "ls | cat",
            "echo hi > file",
        ] {
            assert!(
                headless_command(&session, "/workspace", command).is_err(),
                "{command}"
            );
        }
        let _ = cleanup_headless_session(session);
    }

    #[test]
    fn rejects_shell_tokens() {
        for command in ["echo $(whoami)", "echo `whoami`", "ls && pwd", "cat a;b"] {
            assert!(headless_tokens(command).is_none(), "{command}");
        }
    }

    #[test]
    fn rejects_symlink_escape_when_supported() {
        #[cfg(unix)]
        {
            let session = super::create_headless_session().unwrap();
            std::os::unix::fs::symlink("/etc", session.root.join("workspace/outside")).unwrap();
            assert!(headless_command(&session, "/workspace", "cat outside/passwd").is_err());
            let _ = cleanup_headless_session(session);
        }
    }

    #[test]
    fn exact_workspace_names_are_reapable() {
        assert!(is_headless_workspace_name(
            "polyui-headless-0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_headless_workspace_name("polyui-headless-other"));
        assert!(!is_headless_workspace_name(
            "polyui-headless-0123456789abcdef0123456789abcdef-copy"
        ));
    }

    #[test]
    fn active_pty_blocks_idle_reaping() {
        let mut session = HeadlessSession {
            root: PathBuf::from("/tmp/polyui-headless-test"),
            last_activity: Instant::now() - IDLE_TTL - Duration::from_secs(1),
            active_commands: 0,
        };
        assert!(should_reap_session(&session));
        session.active_commands = 1;
        assert!(!should_reap_session(&session));
    }

    #[test]
    fn workspace_usage_stops_at_limit() {
        let directory = std::env::temp_dir().join(format!("polyui-size-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("file"), b"x").unwrap();
        let usage = workspace_size(&directory, 0).unwrap();
        let _ = std::fs::remove_dir_all(directory);
        assert_eq!(usage, 1);
    }

    #[test]
    fn existing_paths_stay_inside_workspace() {
        let session = super::create_headless_session().unwrap();
        let inside = session.root.join("workspace");
        assert!(path_is_inside(&session.root, &inside));
        assert!(!path_is_inside(
            &session.root,
            PathBuf::from("/etc").as_path()
        ));
        let _ = cleanup_headless_session(session);
    }
}
