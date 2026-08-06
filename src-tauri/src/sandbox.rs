use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const IMAGE: &str = "node@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436";
const MAX_COMMAND_LENGTH: usize = 2_000;
const MAX_SESSION_ID_LENGTH: usize = 200;
const MAX_TOOL_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_WORKSPACE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const ORPHAN_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const IDLE_TTL: Duration = Duration::from_secs(30 * 60);
const REAPER_INTERVAL: Duration = Duration::from_secs(60);
const SANDBOX_CPU_LIMIT: u32 = 4;
const SANDBOX_MEMORY_LIMIT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const SANDBOX_PIDS_LIMIT: u32 = 512;
const SANDBOX_LABEL: &str = "io.polyui.sandbox=true";
const SANDBOX_NETWORK_POLICY: &str = "bridge-egress; preview-target-guarded";
const HEADLESS_NETWORK_POLICY: &str = "none; fixed read-only allowlist";

const BOOTSTRAP: &str = r#"
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  bash coreutils curl git ca-certificates tar gzip unzip passwd sed
command -v node >/dev/null
command -v npm >/dev/null
command -v npx >/dev/null
if ! id sandbox >/dev/null 2>&1; then
  useradd --create-home --home-dir /home/sandbox --shell /bin/bash sandbox
fi
mkdir -p /workspace /home/sandbox /opt/poly-tools/bin /tmp
chown -R sandbox:sandbox /home/sandbox /opt/poly-tools
chmod 0777 /workspace
printf 'sandbox@polyui:%s$ ' >/etc/polyui-prompt
touch /var/lib/polyui-bootstrap-done
"#;

#[derive(Clone)]
pub struct SandboxManager {
    app: AppHandle,
    owner: String,
    state: Arc<Mutex<ManagerState>>,
}

struct ManagerState {
    sessions: HashMap<String, SandboxSession>,
    headless: HashMap<String, HeadlessSession>,
    cache: HostToolCache,
}

struct SandboxSession {
    container: String,
    workspace: PathBuf,
    runtime: Runtime,
    capabilities: HashSet<String>,
    imported: HashSet<String>,
    forwarders: HashMap<u16, PortForwarder>,
    last_activity: Instant,
    active_commands: u32,
}

struct HeadlessSession {
    root: PathBuf,
    last_activity: Instant,
    active_commands: u32,
}

#[derive(Clone)]
struct Runtime {
    program: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SandboxCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub headless: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxPort {
    pub sandbox_id: String,
    pub container_port: u16,
    pub host_port: u16,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxDiagnostics {
    pub sandbox_id: String,
    pub state: &'static str,
    pub runtime: String,
    pub container_name: String,
    pub capabilities: Vec<String>,
    pub imported_tools: Vec<String>,
    pub ports: Vec<SandboxPort>,
    pub workspace_bytes: u64,
    pub workspace_limit_bytes: u64,
    pub memory_limit_bytes: u64,
    pub cpu_limit: u32,
    pub pids_limit: u32,
    pub network_policy: &'static str,
    pub active_commands: u32,
    pub last_activity_age_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostToolEntry {
    name: String,
    executable: String,
    version: String,
    architecture: String,
    checksum: String,
    dependencies: Vec<String>,
    import_strategy: String,
}

#[derive(Default, Serialize, Deserialize)]
struct CacheFile {
    entries: Vec<HostToolEntry>,
}

struct HostToolCache {
    manifest: PathBuf,
    entries: HashMap<String, HostToolEntry>,
}

struct PortForwarder {
    host_port: u16,
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl SandboxManager {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let cache_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join("sandbox-tools");
        fs::create_dir_all(&cache_dir)
            .map_err(|error| format!("sandbox tool cache unavailable: {error}"))?;
        let owner = Uuid::new_v4().simple().to_string();
        thread::spawn(reap_headless_workspaces);
        if let Ok(runtime) = discover_runtime() {
            let reaper_owner = owner.clone();
            thread::spawn(move || match runtime.reap_orphans(&reaper_owner) {
                Ok(workspaces) => reap_orphan_workspaces(&workspaces),
                Err(error) => {
                    crate::startup_log::log_error(format!("sandbox orphan cleanup failed: {error}"))
                }
            });
        }
        let cache = HostToolCache::load(cache_dir.join("index.json"));
        let manager = Self {
            app: app.clone(),
            owner,
            state: Arc::new(Mutex::new(ManagerState {
                sessions: HashMap::new(),
                headless: HashMap::new(),
                cache,
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
            return Err("Sandbox command must be between 1 and 2000 characters.".into());
        }
        let cwd = normalize_cwd(cwd)?;
        status("Checking command policy…");
        // ponytail: one global lock keeps lifecycle/cache updates atomic; use
        // per-sandbox locks if parallel tool calls need higher throughput.
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let created = if !state.sessions.contains_key(sandbox_id) {
            if state.headless.contains_key(sandbox_id) {
                let plan = {
                    let session = state.headless.get(sandbox_id).expect("headless inserted");
                    headless_command(session, &cwd, command)?
                };
                if let Some(plan) = plan {
                    let session = state
                        .headless
                        .get_mut(sandbox_id)
                        .expect("headless inserted");
                    ensure_headless_workspace_room(session)?;
                    touch_headless_session(session);
                    status("Reusing restricted runner…");
                    return Ok(plan);
                }
                if state
                    .headless
                    .get(sandbox_id)
                    .map(|session| session.active_commands > 0)
                    .unwrap_or(false)
                {
                    return Err(
                        "Restricted runner busy; stop its command before starting a full sandbox."
                            .into(),
                    );
                }
                status("Starting full sandbox…");
                let runtime = discover_runtime()?;
                let session = state
                    .headless
                    .remove(sandbox_id)
                    .expect("headless session present");
                cleanup_headless_session(session)?;
                let session = create_session(&runtime, &self.owner, status)?;
                state.sessions.insert(sandbox_id.to_string(), session);
                true
            } else if is_headless_candidate(command) {
                status("Using restricted headless runner…");
                let session = create_headless_session()?;
                let plan = match headless_command(&session, &cwd, command) {
                    Ok(plan) => plan,
                    Err(error) => {
                        let _ = cleanup_headless_session(session);
                        return Err(error);
                    }
                };
                if let Some(plan) = plan {
                    if let Err(error) = ensure_headless_workspace_room(&session) {
                        let _ = cleanup_headless_session(session);
                        return Err(error);
                    }
                    state.headless.insert(sandbox_id.to_string(), session);
                    return Ok(plan);
                }
                cleanup_headless_session(session)?;
                let runtime = discover_runtime()?;
                let session = create_session(&runtime, &self.owner, status)?;
                state.sessions.insert(sandbox_id.to_string(), session);
                true
            } else {
                status("Checking sandbox runtime…");
                let runtime = discover_runtime()?;
                let session = create_session(&runtime, &self.owner, status)?;
                state.sessions.insert(sandbox_id.to_string(), session);
                true
            }
        } else {
            status("Reusing sandbox…");
            false
        };
        let ManagerState {
            sessions, cache, ..
        } = &mut *state;
        status("Checking workspace…");
        let session = sessions.get_mut(sandbox_id).expect("sandbox inserted");
        touch_session(session);
        ensure_workspace_room(session)?;
        status("Preparing command…");
        let ready = {
            let session = sessions.get_mut(sandbox_id).expect("sandbox inserted");
            ensure_command_ready(session, cache, command, status)
        };
        if let Err(error) = ready {
            if created {
                if let Some(session) = sessions.remove(sandbox_id) {
                    let _ = cleanup_session(session);
                }
            }
            return Err(error);
        }
        let session = sessions.get(sandbox_id).expect("sandbox inserted");
        Ok(command_for(session, &cwd, command))
    }

    pub fn command_started(&self, sandbox_id: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if let Some(session) = state.sessions.get_mut(sandbox_id) {
            session.active_commands = session.active_commands.saturating_add(1);
            touch_session(session);
            return Ok(());
        }
        if let Some(session) = state.headless.get_mut(sandbox_id) {
            session.active_commands = session.active_commands.saturating_add(1);
            touch_headless_session(session);
            return Ok(());
        }
        Err("Sandbox session not found.".into())
    }

    pub fn command_finished(&self, sandbox_id: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if let Some(session) = state.sessions.get_mut(sandbox_id) {
            session.active_commands = session.active_commands.saturating_sub(1);
            touch_session(session);
            return Ok(());
        }
        if let Some(session) = state.headless.get_mut(sandbox_id) {
            session.active_commands = session.active_commands.saturating_sub(1);
            touch_headless_session(session);
            return Ok(());
        }
        Err("Sandbox session not found.".into())
    }

    pub fn workspace_usage(&self, sandbox_id: &str) -> Result<u64, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        let root = state
            .sessions
            .get(sandbox_id)
            .map(|session| session.workspace.clone())
            .or_else(|| {
                state
                    .headless
                    .get(sandbox_id)
                    .map(|session| session.root.clone())
            })
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        workspace_size(&root, MAX_WORKSPACE_BYTES)
            .map_err(|error| format!("sandbox workspace size unavailable: {error}"))
    }

    pub fn workspace_limit_reached(&self, sandbox_id: &str) -> Result<bool, String> {
        Ok(self.workspace_usage(sandbox_id)? > MAX_WORKSPACE_BYTES)
    }

    pub fn diagnostics(&self, sandbox_id: &str) -> Result<SandboxDiagnostics, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if let Some(session) = state.sessions.get(sandbox_id) {
            return container_diagnostics(sandbox_id, session);
        }
        let session = state
            .headless
            .get(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        let workspace_bytes = workspace_size(&session.root, MAX_WORKSPACE_BYTES)
            .map_err(|error| format!("sandbox workspace size unavailable: {error}"))?;
        Ok(SandboxDiagnostics {
            sandbox_id: sandbox_id.to_string(),
            state: "ready",
            runtime: "host-restricted".into(),
            container_name: "none (headless)".into(),
            capabilities: vec!["read-only".into()],
            imported_tools: vec![],
            ports: vec![],
            workspace_bytes,
            workspace_limit_bytes: MAX_WORKSPACE_BYTES,
            memory_limit_bytes: 0,
            cpu_limit: 0,
            pids_limit: 0,
            network_policy: HEADLESS_NETWORK_POLICY,
            active_commands: session.active_commands,
            last_activity_age_ms: session.last_activity.elapsed().as_millis() as u64,
        })
    }

    pub fn refresh_ports(&self, sandbox_id: &str) -> Result<Vec<SandboxPort>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if let Some(session) = state.headless.get_mut(sandbox_id) {
            touch_headless_session(session);
            return Ok(vec![]);
        }
        let session = state
            .sessions
            .get_mut(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        touch_session(session);
        let raw = session.runtime.exec_capture(&[
            "exec".into(),
            "--user".into(),
            "sandbox".into(),
            session.container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null".into(),
        ])?;
        let ports = listening_ports(&raw);
        let ip = container_ip(&session.runtime, &session.container)?;
        let mut result = Vec::with_capacity(ports.len());
        for port in ports {
            if !session.forwarders.contains_key(&port) {
                session
                    .forwarders
                    .insert(port, PortForwarder::new(ip, port)?);
            }
            let forwarder = session.forwarders.get(&port).expect("forwarder inserted");
            let host_port = forwarder.host_port;
            let entry = SandboxPort {
                sandbox_id: sandbox_id.to_string(),
                container_port: port,
                host_port,
                url: format!("http://127.0.0.1:{host_port}"),
            };
            let _ = self.app.emit("sandbox-port", &entry);
            result.push(entry);
        }
        Ok(result)
    }

    pub fn stop_processes(&self, sandbox_id: &str) -> Result<(), String> {
        validate_session_id(sandbox_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
        if let Some(session) = state.headless.get_mut(sandbox_id) {
            touch_headless_session(session);
            return Ok(());
        }
        let session = state
            .sessions
            .get_mut(sandbox_id)
            .ok_or_else(|| "Sandbox session not found.".to_string())?;
        touch_session(session);
        let script = r#"
set +e
sandbox_uid="$(id -u)"
for signal in TERM KILL; do
  for process in /proc/[0-9]*; do
    pid="${process##*/}"
    [ "$pid" = "$$" ] && continue
    uid="$(sed -n 's/^Uid:[[:space:]]*\([0-9]*\).*/\1/p' "$process/status" 2>/dev/null)"
    [ "$uid" = "$sandbox_uid" ] && kill -"$signal" "$pid" 2>/dev/null
  done
  [ "$signal" = "TERM" ] && sleep 1
done
"#;
        session.runtime.checked(&[
            "exec".into(),
            "--user".into(),
            "sandbox".into(),
            session.container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            script.into(),
        ])
    }

    pub fn destroy(&self, sandbox_id: &str) -> Result<(), String> {
        validate_session_id(sandbox_id)?;
        let (session, headless) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
            (
                state.sessions.remove(sandbox_id),
                state.headless.remove(sandbox_id),
            )
        };
        if let Some(session) = session {
            let _ = self.app.emit("sandbox-destroyed", sandbox_id);
            cleanup_session(session)?;
        }
        if let Some(session) = headless {
            let _ = self.app.emit("sandbox-destroyed", sandbox_id);
            cleanup_headless_session(session)?;
        }
        Ok(())
    }

    pub fn destroy_all(&self) -> Result<(), String> {
        let (sessions, headless) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "Sandbox state lock poisoned.".to_string())?;
            (
                std::mem::take(&mut state.sessions),
                std::mem::take(&mut state.headless),
            )
        };
        let mut first_error = None;
        for (sandbox_id, session) in sessions {
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
            if let Err(error) = cleanup_session(session) {
                first_error.get_or_insert(error);
            }
        }
        for (sandbox_id, session) in headless {
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
            if let Err(error) = cleanup_headless_session(session) {
                first_error.get_or_insert(error);
            }
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
        let (expired, expired_headless) = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            let ids: Vec<_> = state
                .sessions
                .iter()
                .filter(|(_, session)| should_reap_session(session))
                .map(|(id, _)| id.clone())
                .collect();
            let expired = ids
                .into_iter()
                .filter_map(|id| state.sessions.remove(&id).map(|session| (id, session)))
                .collect::<Vec<_>>();
            let ids: Vec<_> = state
                .headless
                .iter()
                .filter(|(_, session)| should_reap_headless_session(session))
                .map(|(id, _)| id.clone())
                .collect();
            let expired_headless = ids
                .into_iter()
                .filter_map(|id| state.headless.remove(&id).map(|session| (id, session)))
                .collect::<Vec<_>>();
            (expired, expired_headless)
        };
        for (sandbox_id, session) in expired {
            if let Err(error) = cleanup_session(session) {
                crate::startup_log::log_error(format!(
                    "idle sandbox cleanup failed for {sandbox_id}: {error}"
                ));
            }
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
        }
        for (sandbox_id, session) in expired_headless {
            if let Err(error) = cleanup_headless_session(session) {
                crate::startup_log::log_error(format!(
                    "idle headless cleanup failed for {sandbox_id}: {error}"
                ));
            }
            let _ = self.app.emit("sandbox-destroyed", &sandbox_id);
        }
    }
}

fn container_diagnostics(
    sandbox_id: &str,
    session: &SandboxSession,
) -> Result<SandboxDiagnostics, String> {
    let workspace_bytes = workspace_size(&session.workspace, MAX_WORKSPACE_BYTES)
        .map_err(|error| format!("sandbox workspace size unavailable: {error}"))?;
    let mut capabilities: Vec<_> = session.capabilities.iter().cloned().collect();
    capabilities.sort();
    let mut imported_tools: Vec<_> = session.imported.iter().cloned().collect();
    imported_tools.sort();
    let mut ports: Vec<_> = session
        .forwarders
        .iter()
        .map(|(container_port, forwarder)| SandboxPort {
            sandbox_id: sandbox_id.to_string(),
            container_port: *container_port,
            host_port: forwarder.host_port,
            url: format!("http://127.0.0.1:{}", forwarder.host_port),
        })
        .collect();
    ports.sort_by_key(|port| port.container_port);
    Ok(SandboxDiagnostics {
        sandbox_id: sandbox_id.to_string(),
        state: "ready",
        runtime: runtime_name(&session.runtime.program),
        container_name: session.container.clone(),
        capabilities,
        imported_tools,
        ports,
        workspace_bytes,
        workspace_limit_bytes: MAX_WORKSPACE_BYTES,
        memory_limit_bytes: SANDBOX_MEMORY_LIMIT_BYTES,
        cpu_limit: SANDBOX_CPU_LIMIT,
        pids_limit: SANDBOX_PIDS_LIMIT,
        network_policy: SANDBOX_NETWORK_POLICY,
        active_commands: session.active_commands,
        last_activity_age_ms: session.last_activity.elapsed().as_millis() as u64,
    })
}

impl HostToolCache {
    fn load(manifest: PathBuf) -> Self {
        let _ = set_private_file_permissions(&manifest);
        let entries = fs::read_to_string(&manifest)
            .ok()
            .and_then(|raw| serde_json::from_str::<CacheFile>(&raw).ok())
            .map(|file| {
                file.entries
                    .into_iter()
                    .map(|entry| (entry.name.clone(), entry))
                    .collect()
            })
            .unwrap_or_default();
        Self { manifest, entries }
    }

    fn save(&self) {
        let mut entries: Vec<_> = self.entries.values().cloned().collect();
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        let file = CacheFile { entries };
        if let Ok(raw) = serde_json::to_vec_pretty(&file) {
            let Some(parent) = self.manifest.parent() else {
                return;
            };
            let temporary = parent.join(format!(
                ".{}.tmp-{}",
                self.manifest
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("index.json"),
                Uuid::new_v4().simple()
            ));
            if fs::write(&temporary, raw).is_ok() {
                let _ = set_private_file_permissions(&temporary);
                // ponytail: rename is atomic on Unix; the fallback keeps
                // Windows cache writes working when rename refuses overwrite.
                if fs::rename(&temporary, &self.manifest).is_err() {
                    let _ = fs::remove_file(&self.manifest);
                    let _ = fs::rename(&temporary, &self.manifest);
                }
            }
        }
    }

    fn cache_tool(&mut self, name: &str) -> Result<Option<HostToolEntry>, String> {
        if let Some(entry) = self.entries.get(name).cloned() {
            if self.cache_entry_usable(&entry) && discover_host_tool(name).is_none() {
                return Ok(Some(entry.clone()));
            }
            if !self.cache_entry_usable(&entry) {
                self.entries.remove(name);
                self.save();
            }
        }
        let Some(path) = discover_host_tool(name) else {
            return Ok(None);
        };
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.len() > MAX_TOOL_BYTES || !compatible_tool(&path)? {
            return Ok(None);
        }
        let checksum = checksum(&path)?;
        if let Some(entry) = self.entries.get(name) {
            if entry.checksum == checksum && self.cache_entry_usable(entry) {
                return Ok(Some(entry.clone()));
            }
        }
        let cached_path = self
            .manifest
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{checksum}-{name}"));
        if !cached_path.is_file() {
            let temporary = cached_path.with_file_name(format!(
                ".{}.tmp-{}",
                cached_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("tool"),
                Uuid::new_v4().simple()
            ));
            fs::copy(&path, &temporary)
                .map_err(|error| format!("cannot cache host tool {name}: {error}"))?;
            set_private_file_permissions(&temporary)?;
            fs::rename(&temporary, &cached_path)
                .map_err(|error| format!("cannot finalize cached host tool {name}: {error}"))?;
        }
        set_private_file_permissions(&cached_path)?;
        let entry = HostToolEntry {
            name: name.to_string(),
            executable: cached_path.display().to_string(),
            version: "unknown".into(),
            architecture: tool_architecture(&path),
            checksum,
            dependencies: tool_dependencies(&path)?,
            import_strategy: "copy-executable".into(),
        };
        self.entries.insert(name.to_string(), entry.clone());
        self.evict_old_entries();
        self.save();
        Ok(Some(entry))
    }

    fn cache_entry_usable(&self, entry: &HostToolEntry) -> bool {
        let Some(root) = self
            .manifest
            .parent()
            .and_then(|path| path.canonicalize().ok())
        else {
            return false;
        };
        let Ok(path) = Path::new(&entry.executable).canonicalize() else {
            return false;
        };
        path.starts_with(root)
            && compatible_tool(&path).unwrap_or(false)
            && tool_architecture(&path) == entry.architecture
            && checksum(&path).map_or(false, |value| value == entry.checksum)
    }

    fn evict_old_entries(&mut self) {
        let Some(root) = self
            .manifest
            .parent()
            .and_then(|directory| directory.canonicalize().ok())
        else {
            return;
        };
        let mut total = 0_u64;
        let mut candidates = Vec::new();
        for (name, entry) in &self.entries {
            let Ok(path) = Path::new(&entry.executable).canonicalize() else {
                continue;
            };
            if !path.starts_with(&root) {
                continue;
            }
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            total = total.saturating_add(metadata.len());
            candidates.push((
                name.clone(),
                path,
                metadata.len(),
                metadata.modified().unwrap_or(UNIX_EPOCH),
            ));
        }
        if total <= MAX_CACHE_BYTES {
            return;
        }
        candidates.sort_by_key(|(_, _, _, modified)| *modified);
        for (name, path, size, _) in candidates {
            if total <= MAX_CACHE_BYTES {
                break;
            }
            self.entries.remove(&name);
            let _ = fs::remove_file(path);
            total = total.saturating_sub(size);
        }
    }
}

fn discover_runtime() -> Result<Runtime, String> {
    let mut candidates = vec![
        PathBuf::from("/usr/bin/docker"),
        PathBuf::from("/usr/local/bin/docker"),
        PathBuf::from("/usr/bin/podman"),
        PathBuf::from("/usr/local/bin/podman"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            candidates.extend([directory.join("docker"), directory.join("podman")]);
        }
    }
    for path in candidates {
        if path.is_file() {
            return Ok(Runtime { program: path });
        }
    }
    Err(
        "AI terminal sandbox unavailable: install Docker or Podman. Host execution is disabled."
            .into(),
    )
}

fn create_session(
    runtime: &Runtime,
    owner: &str,
    status: &dyn Fn(&str),
) -> Result<SandboxSession, String> {
    let token = Uuid::new_v4().simple().to_string();
    let workspace = std::env::temp_dir().join(format!("polyui-sandbox-{token}"));
    fs::create_dir(&workspace)
        .map_err(|error| format!("sandbox workspace unavailable: {error}"))?;
    set_private_permissions(&workspace)?;
    let container = format!("polyui-sandbox-{token}");
    let volume = format!("{}:/workspace:rw", workspace.display());
    let result = (|| {
        status("Creating sandbox container…");
        runtime.checked(&[
            "run".into(),
            "--detach".into(),
            "--rm".into(),
            "--name".into(),
            container.clone(),
            "--label".into(),
            SANDBOX_LABEL.into(),
            "--label".into(),
            format!("io.polyui.owner={owner}"),
            "--hostname".into(),
            "polyui".into(),
            "--workdir".into(),
            "/workspace".into(),
            "--network".into(),
            "bridge".into(),
            "--cap-drop".into(),
            "ALL".into(),
            "--cap-add".into(),
            "SETUID".into(),
            "--cap-add".into(),
            "SETGID".into(),
            "--cap-add".into(),
            "CHOWN".into(),
            "--cap-add".into(),
            "DAC_OVERRIDE".into(),
            "--cap-add".into(),
            "FOWNER".into(),
            "--security-opt".into(),
            "no-new-privileges".into(),
            "--pids-limit".into(),
            SANDBOX_PIDS_LIMIT.to_string(),
            "--memory".into(),
            format!("{}g", SANDBOX_MEMORY_LIMIT_BYTES / (1024 * 1024 * 1024)),
            "--cpus".into(),
            SANDBOX_CPU_LIMIT.to_string(),
            "--tmpfs".into(),
            "/tmp:rw,nosuid,nodev".into(),
            "--env".into(),
            "POLYUI_SANDBOX=1".into(),
            "--volume".into(),
            volume,
            IMAGE.into(),
            "/bin/sh".into(),
            "-c".into(),
            "exec sleep infinity".into(),
        ])?;
        status("Installing sandbox base tools…");
        runtime.checked(&[
            "exec".into(),
            "--user".into(),
            "0".into(),
            container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            BOOTSTRAP.into(),
        ])?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = runtime.checked(&["rm".into(), "--force".into(), container]);
        let _ = fs::remove_dir_all(&workspace);
        return Err(format!("sandbox creation failed: {error}"));
    }
    Ok(SandboxSession {
        container,
        workspace,
        runtime: runtime.clone(),
        capabilities: HashSet::new(),
        imported: HashSet::new(),
        forwarders: HashMap::new(),
        last_activity: Instant::now(),
        active_commands: 0,
    })
}

fn create_headless_session() -> Result<HeadlessSession, String> {
    let token = Uuid::new_v4().simple().to_string();
    let root = std::env::temp_dir().join(format!("polyui-headless-{token}"));
    let result = (|| {
        fs::create_dir(&root)
            .map_err(|error| format!("headless workspace unavailable: {error}"))?;
        set_private_permissions(&root)?;
        for directory in [
            root.join("workspace"),
            root.join("home/sandbox"),
            root.join("tmp"),
        ] {
            fs::create_dir_all(&directory)
                .map_err(|error| format!("headless workspace unavailable: {error}"))?;
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

fn cleanup_session(session: SandboxSession) -> Result<(), String> {
    let container = session.container.clone();
    let runtime_error = session
        .runtime
        .checked(&["rm".into(), "--force".into(), container])
        .err();
    let workspace_error = fs::remove_dir_all(&session.workspace).err();
    runtime_error
        .or_else(|| {
            workspace_error.map(|error| format!("sandbox workspace cleanup failed: {error}"))
        })
        .map_or(Ok(()), Err)
}

fn cleanup_headless_session(session: HeadlessSession) -> Result<(), String> {
    fs::remove_dir_all(&session.root)
        .map_err(|error| format!("headless workspace cleanup failed: {error}"))
}

fn ensure_workspace_room(session: &SandboxSession) -> Result<(), String> {
    ensure_workspace_room_at(&session.workspace)
}

fn ensure_headless_workspace_room(session: &HeadlessSession) -> Result<(), String> {
    ensure_workspace_room_at(&session.root)
}

fn ensure_workspace_room_at(root: &Path) -> Result<(), String> {
    let size = workspace_size(root, MAX_WORKSPACE_BYTES)
        .map_err(|error| format!("sandbox workspace size unavailable: {error}"))?;
    if size > MAX_WORKSPACE_BYTES {
        return Err(workspace_limit_message());
    }
    Ok(())
}

fn workspace_limit_message() -> String {
    "Sandbox workspace limit reached (8 GiB). Delete files or reset the sandbox to continue.".into()
}

fn touch_session(session: &mut SandboxSession) {
    session.last_activity = Instant::now();
}

fn touch_headless_session(session: &mut HeadlessSession) {
    session.last_activity = Instant::now();
}

fn should_reap_session(session: &SandboxSession) -> bool {
    session.active_commands == 0 && session.last_activity.elapsed() >= IDLE_TTL
}

fn should_reap_headless_session(session: &HeadlessSession) -> bool {
    session.active_commands == 0 && session.last_activity.elapsed() >= IDLE_TTL
}

fn runtime_name(program: &Path) -> String {
    program
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| *name == "docker" || *name == "podman")
        .unwrap_or("container-runtime")
        .to_string()
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

fn command_for(session: &SandboxSession, cwd: &str, command: &str) -> SandboxCommand {
    let shown = shell_quote(command);
    let script = format!("printf '\\r\\nsandbox@polyui:%s$ %s\\r\\n' \"$PWD\" {shown}; {command}",);
    SandboxCommand {
        program: session.runtime.program.clone(),
        args: vec![
            "exec".into(),
            "--interactive".into(),
            "--tty".into(),
            "--user".into(),
            "sandbox".into(),
            "--workdir".into(),
            cwd.into(),
            "--env".into(),
            "HOME=/home/sandbox".into(),
            "--env".into(),
            "USER=sandbox".into(),
            "--env".into(),
            "TERM=xterm-256color".into(),
            "--env".into(),
            "PS1=sandbox@polyui:\\w$ ".into(),
            "--env".into(),
            "HOST=0.0.0.0".into(),
            "--env".into(),
            "BIND=0.0.0.0".into(),
            "--env".into(),
            "PATH=/opt/poly-tools/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
                .into(),
            session.container.clone(),
            "/bin/bash".into(),
            "--noprofile".into(),
            "--norc".into(),
            "-lc".into(),
            script,
        ],
        cwd: None,
        env: vec![],
        headless: false,
    }
}

fn is_headless_candidate(command: &str) -> bool {
    let Some(tokens) = headless_tokens(command) else {
        return false;
    };
    headless_program(tokens.first().map(String::as_str).unwrap_or_default()).is_some()
        && headless_shape(&tokens)
}

fn headless_command(
    session: &HeadlessSession,
    cwd: &str,
    command: &str,
) -> Result<Option<SandboxCommand>, String> {
    let Some(tokens) = headless_tokens(command) else {
        return Ok(None);
    };
    if !headless_shape(&tokens) {
        return Ok(None);
    }
    let name = tokens.first().map(String::as_str).unwrap_or_default();
    let Some(program) = headless_program(name) else {
        return Ok(None);
    };
    let Some(physical_cwd) = headless_cwd(session, cwd) else {
        return Ok(None);
    };
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
        "ls" => match headless_ls_args(session, cwd, &tokens[1..]) {
            Ok(args) => args,
            Err(_) => return Ok(None),
        },
        "cat" | "head" | "tail" | "wc" => {
            match headless_file_args(session, cwd, &tokens[1..], true) {
                Ok(args) => args,
                Err(_) => return Ok(None),
            }
        }
        "grep" | "rg" => match headless_search_args(session, cwd, &tokens[1..]) {
            Ok(args) => args,
            Err(_) => return Ok(None),
        },
        _ => return Ok(None),
    };
    Ok(Some(SandboxCommand {
        program,
        args,
        cwd: Some(physical_cwd),
        env: headless_environment(session),
        headless: true,
    }))
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
}

fn headless_tokens(command: &str) -> Option<Vec<String>> {
    if command.is_empty()
        || command.chars().any(|character| {
            character.is_ascii_control() || ";|&><`$(){}[]*?\\'\"".contains(character)
        })
    {
        return None;
    }
    let tokens = shell_words(command);
    (!tokens.is_empty() && tokens.len() <= 16).then_some(tokens)
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
    [Path::new("/usr/bin"), Path::new("/bin")]
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|path| {
            fs::metadata(path)
                .map(|metadata| metadata.is_file() && executable(&metadata))
                .unwrap_or(false)
        })
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
                return Err("headless ls option rejected".into());
            }
            args.push(token.clone());
        } else if path.is_none() {
            path = Some(headless_path_arg(session, cwd, token)?);
        } else {
            return Err("headless ls accepts one path".into());
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
        return Err("headless file command requires a path".into());
    }
    tokens
        .iter()
        .map(|token| {
            if token.starts_with('-') {
                return Err("headless file option rejected".into());
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
    let Some(pattern) = tokens.first().filter(|_| tokens.len() >= 2) else {
        return Err("headless search requires a pattern".into());
    };
    if pattern.starts_with('-') {
        return Err("headless search option rejected".into());
    }
    let mut args = vec![pattern.clone()];
    args.extend(headless_file_args(session, cwd, &tokens[1..], false)?);
    Ok(args)
}

fn headless_environment(session: &HeadlessSession) -> Vec<(String, String)> {
    vec![
        (
            "HOME".into(),
            session.root.join("home/sandbox").display().to_string(),
        ),
        ("USER".into(), "sandbox".into()),
        ("LOGNAME".into(), "sandbox".into()),
        ("PATH".into(), "/usr/bin:/bin".into()),
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
    ]
}

fn headless_cwd(session: &HeadlessSession, cwd: &str) -> Option<PathBuf> {
    let path = headless_physical_path(&session.root, Path::new(cwd))?;
    path.is_dir().then_some(path)
}

fn headless_path_arg(session: &HeadlessSession, cwd: &str, raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw == "-" || raw.contains('\0') {
        return Err("headless path rejected".into());
    }
    let path = Path::new(raw);
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("headless path cannot contain '..'".into());
    }
    let virtual_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(cwd).join(path)
    };
    if headless_physical_path(&session.root, &virtual_path).is_none() {
        return Err("headless path must stay inside the sandbox workspace".into());
    }
    Ok(relative_virtual_path(Path::new(cwd), &virtual_path))
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

fn ensure_command_ready(
    session: &mut SandboxSession,
    cache: &mut HostToolCache,
    command: &str,
    status: &dyn Fn(&str),
) -> Result<(), String> {
    let mut names = Vec::new();
    if let Some(name) = first_command_name(command) {
        names.push(name);
    }
    for token in shell_words(command) {
        let name = token.rsplit('/').next().unwrap_or(&token);
        if capability(name).is_some() && !names.iter().any(|item| item == name) {
            names.push(name.to_string());
        }
    }
    for name in names {
        ensure_tool_ready(session, cache, &name, status)?;
    }
    Ok(())
}

fn ensure_tool_ready(
    session: &mut SandboxSession,
    cache: &mut HostToolCache,
    name: &str,
    status: &dyn Fn(&str),
) -> Result<(), String> {
    if session.has_command(name)? {
        return Ok(());
    }
    if !session.imported.contains(name) {
        if let Some(mut entry) = cache.cache_tool(&name)? {
            status(&format!("Importing {name}…"));
            let imported = import_tool(session, &entry)
                .and_then(|_| session.command_works(name))
                .unwrap_or(false);
            if imported {
                if entry.version == "unknown" {
                    if let Some(version) = imported_tool_version(session, &entry.name) {
                        entry.version = version;
                        cache.entries.insert(name.to_string(), entry);
                        cache.save();
                    }
                }
                session.imported.insert(name.to_string());
                return Ok(());
            }
            remove_imported_tool(session, name);
            let _ = fs::remove_file(&entry.executable);
            cache.entries.remove(name);
            cache.save();
        }
    }
    let Some(capability) = capability(&name) else {
        return Ok(());
    };
    if session.capabilities.contains(capability.name()) {
        return Ok(());
    }
    status(&format!("Installing {}…", capability.name()));
    install_capability(session, capability)?;
    session.capabilities.insert(capability.name().into());
    Ok(())
}

impl SandboxSession {
    fn has_command(&self, name: &str) -> Result<bool, String> {
        let output = self.runtime.exec_output(&[
            "exec".into(),
            "--user".into(),
            "sandbox".into(),
            self.container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            format!("command -v {} >/dev/null 2>&1", shell_quote(name)),
        ])?;
        Ok(output.status.success())
    }

    fn command_works(&self, name: &str) -> Result<bool, String> {
        let output = self.runtime.exec_output(&[
            "exec".into(),
            "--user".into(),
            "sandbox".into(),
            self.container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            format!(
                "command -v {0} >/dev/null 2>&1 && {0} --version >/dev/null 2>&1",
                shell_quote(name)
            ),
        ])?;
        Ok(output.status.success())
    }
}

fn import_tool(session: &SandboxSession, entry: &HostToolEntry) -> Result<(), String> {
    let destination = format!("{}:/opt/poly-tools/bin/{}", session.container, entry.name);
    session
        .runtime
        .checked(&["cp".into(), entry.executable.clone(), destination])?;
    session.runtime.checked(&[
        "exec".into(),
        "--user".into(),
        "0".into(),
        session.container.clone(),
        "/bin/chmod".into(),
        "0755".into(),
        format!("/opt/poly-tools/bin/{}", entry.name),
    ])
}

fn remove_imported_tool(session: &SandboxSession, name: &str) {
    let _ = session.runtime.checked(&[
        "exec".into(),
        "--user".into(),
        "0".into(),
        session.container.clone(),
        "/bin/rm".into(),
        "-f".into(),
        format!("/opt/poly-tools/bin/{}", name),
    ]);
}

fn imported_tool_version(session: &SandboxSession, name: &str) -> Option<String> {
    let output = session
        .runtime
        .exec_capture(&[
            "exec".into(),
            "--user".into(),
            "sandbox".into(),
            session.container.clone(),
            "/bin/sh".into(),
            "-lc".into(),
            format!(
                "{} --version 2>/dev/null | head -n 1",
                shell_quote(&format!("/opt/poly-tools/bin/{name}"))
            ),
        ])
        .ok()?;
    let version = output.trim().to_string();
    (!version.is_empty() && version.len() <= 200).then_some(version)
}

#[derive(Clone, Copy)]
enum Capability {
    Apt(&'static str, &'static [&'static str]),
    Npm(&'static str),
}

impl Capability {
    fn name(self) -> &'static str {
        match self {
            Self::Apt(name, _) | Self::Npm(name) => name,
        }
    }
}

fn capability(name: &str) -> Option<Capability> {
    match name {
        "python" | "python3" | "pip" | "pip3" => {
            Some(Capability::Apt("python", &["python3", "python3-pip"]))
        }
        "rustc" | "cargo" => Some(Capability::Apt("rust", &["rustc", "cargo"])),
        "go" | "gofmt" => Some(Capability::Apt("go", &["golang"])),
        "java" | "javac" => Some(Capability::Apt("java", &["default-jdk"])),
        "bun" => Some(Capability::Npm("bun")),
        "cc" | "gcc" | "g++" | "make" | "ld" => {
            Some(Capability::Apt("build-essential", &["build-essential"]))
        }
        "cmake" => Some(Capability::Apt("cmake", &["cmake"])),
        "ffmpeg" => Some(Capability::Apt("ffmpeg", &["ffmpeg"])),
        "convert" | "magick" => Some(Capability::Apt("imagemagick", &["imagemagick"])),
        "sqlite3" => Some(Capability::Apt("sqlite", &["sqlite3"])),
        "rg" => Some(Capability::Apt("ripgrep", &["ripgrep"])),
        "fd" | "fdfind" => Some(Capability::Apt("fd", &["fd-find"])),
        "jq" => Some(Capability::Apt("jq", &["jq"])),
        "clang" => Some(Capability::Apt("clang", &["clang"])),
        "ninja" => Some(Capability::Apt("ninja", &["ninja-build"])),
        "tree" => Some(Capability::Apt("tree", &["tree"])),
        "wget" => Some(Capability::Apt("wget", &["wget"])),
        _ => None,
    }
}

fn install_capability(session: &SandboxSession, capability: Capability) -> Result<(), String> {
    match capability {
        Capability::Apt(name, packages) => {
            let aliases = match name {
                "python" => "ln -sf /usr/bin/python3 /usr/local/bin/python; ln -sf /usr/bin/pip3 /usr/local/bin/pip",
                "fd" => "ln -sf /usr/bin/fdfind /usr/local/bin/fd",
                _ => ":",
            };
            let args = vec![
                "exec".into(),
                "--user".into(),
                "0".into(),
                session.container.clone(),
                "/bin/sh".into(),
                "-lc".into(),
                format!(
                    "apt-get install -y --no-install-recommends {}; {}",
                    packages.join(" "),
                    aliases,
                ),
            ];
            session.runtime.checked(&args)
        }
        Capability::Npm(package) => session.runtime.checked(&[
            "exec".into(),
            "--user".into(),
            "0".into(),
            session.container.clone(),
            "npm".into(),
            "install".into(),
            "--global".into(),
            "--no-fund".into(),
            "--no-audit".into(),
            package.into(),
        ]),
    }
}

impl Runtime {
    fn exec_output(&self, args: &[String]) -> Result<Output, String> {
        Command::new(&self.program)
            .args(args)
            .output()
            .map_err(|error| format!("sandbox runtime failed to start: {error}"))
    }

    fn checked(&self, args: &[String]) -> Result<(), String> {
        let output = self.exec_output(args)?;
        if output.status.success() {
            return Ok(());
        }
        Err(format!("{}", command_error(&output).trim_end_matches('\n')))
    }

    fn exec_capture(&self, args: &[String]) -> Result<String, String> {
        let output = self.exec_output(args)?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn reap_orphans(&self, owner: &str) -> Result<HashSet<String>, String> {
        let mut active_workspaces = HashSet::new();
        let output = self.exec_output(&[
            "ps".into(),
            "--all".into(),
            "--quiet".into(),
            "--filter".into(),
            format!("label={SANDBOX_LABEL}"),
        ])?;
        if !output.status.success() {
            return Err(command_error(&output));
        }
        for id in String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        {
            let metadata = self.exec_capture(&[
                "inspect".into(),
                "--format".into(),
                "{{.State.Running}}\t{{.Created}}\t{{index .Config.Labels \"io.polyui.owner\"}}\t{{.Name}}".into(),
                id.into(),
            ])?;
            let mut fields = metadata.trim().split('\t');
            let running = fields.next() == Some("true");
            let created = fields.next().unwrap_or_default();
            let container_owner = fields.next().unwrap_or_default();
            let name = fields.next().unwrap_or_default().trim_start_matches('/');
            if container_owner == owner {
                if running && !name.is_empty() {
                    active_workspaces.insert(name.to_string());
                }
                continue;
            }
            if should_reap_orphan(&container_owner, owner, running, created) {
                self.checked(&["rm".into(), "--force".into(), id.into()])?;
            } else if !name.is_empty() {
                active_workspaces.insert(name.to_string());
            }
        }
        Ok(active_workspaces)
    }
}

fn command_error(output: &Output) -> String {
    let mut error = String::from_utf8_lossy(&output.stderr).into_owned();
    if error.trim().is_empty() {
        error = String::from_utf8_lossy(&output.stdout).into_owned();
    }
    let mut lines: Vec<&str> = error.lines().collect();
    if lines.len() > 8 {
        lines = lines.split_off(lines.len() - 8);
    }
    lines.join("\n")
}

fn stale_timestamp(value: &str) -> bool {
    let Ok(created) = chrono::DateTime::parse_from_rfc3339(value) else {
        return false;
    };
    let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return false;
    };
    let created = created.timestamp().max(0) as u64;
    now.as_secs().saturating_sub(created) >= ORPHAN_TTL.as_secs()
}

fn should_reap_orphan(container_owner: &str, owner: &str, running: bool, created: &str) -> bool {
    container_owner != owner && (!running || stale_timestamp(created))
}

fn reap_orphan_workspaces(protected: &HashSet<String>) {
    let root = std::env::temp_dir();
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_sandbox_workspace_name(name) {
            continue;
        }
        if protected.contains(name) {
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
            if let Err(error) = fs::remove_dir_all(&path) {
                crate::startup_log::log_error(format!(
                    "sandbox workspace cleanup failed for {}: {error}",
                    path.display()
                ));
            }
        }
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

fn is_sandbox_workspace_name(name: &str) -> bool {
    let Some(token) = name.strip_prefix("polyui-sandbox-") else {
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
        Ok(path.display().to_string())
    } else {
        Err("Sandbox cwd must stay under /workspace, /home/sandbox, or /tmp.".into())
    }
}

pub fn first_command_name(command: &str) -> Option<String> {
    let mut tokens = shell_words(command);
    while let Some(token) = tokens.first() {
        if token.contains('=') && !token.starts_with('=') {
            tokens.remove(0);
            continue;
        }
        if token == "env" {
            tokens.remove(0);
            continue;
        }
        break;
    }
    tokens
        .first()
        .map(|value| value.rsplit('/').next().unwrap_or(value).to_string())
        .filter(|value| !value.is_empty())
}

fn shell_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            word.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if character == active {
                quote = None;
            } else {
                word.push(character);
            }
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push(character);
        }
    }
    if escaped {
        word.push('\\');
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn discover_host_tool(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return None;
    }
    let mut directories = vec![PathBuf::from("/usr/bin"), PathBuf::from("/usr/local/bin")];
    if let Some(home) = dirs::home_dir() {
        directories.extend([
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".bun/bin"),
        ]);
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories.into_iter().find_map(|directory| {
        let path = directory.join(name);
        let metadata = fs::metadata(&path).ok()?;
        if metadata.is_file() && executable(&metadata) {
            Some(path)
        } else {
            None
        }
    })
}

fn compatible_tool(path: &Path) -> Result<bool, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_TOOL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_TOOL_BYTES {
        return Ok(false);
    }
    if bytes.starts_with(b"#!") {
        let line = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]);
        return Ok(line.contains("/bin/sh")
            || line.contains("/bin/bash")
            || line.contains("/usr/bin/env")
            || line.contains("/usr/bin/node"));
    }
    if bytes.get(0..4) != Some(b"\x7fELF") {
        return Ok(false);
    }
    if bytes.len() < 20 {
        return Ok(false);
    }
    let little = bytes.get(5).copied() == Some(1);
    let machine = if little {
        u16::from_le_bytes([bytes[18], bytes[19]])
    } else {
        u16::from_be_bytes([bytes[18], bytes[19]])
    };
    let expected = match std::env::consts::ARCH {
        "x86_64" => 0x3e,
        "aarch64" => 0xb7,
        "x86" => 0x03,
        "arm" => 0x28,
        _ => return Ok(false),
    };
    if machine != expected {
        return Ok(false);
    }
    Ok(!bytes.windows(7).any(|window| window == b"ld-linux"))
}

fn tool_architecture(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return "unknown".into();
    };
    let mut bytes = [0_u8; 20];
    if file.read_exact(&mut bytes).is_err() || &bytes[..4] != b"\x7fELF" {
        return "script".into();
    }
    let little = bytes[5] == 1;
    let machine = if little {
        u16::from_le_bytes([bytes[18], bytes[19]])
    } else {
        u16::from_be_bytes([bytes[18], bytes[19]])
    };
    match machine {
        0x03 => "x86".into(),
        0x28 => "arm".into(),
        0x3e => "x86_64".into(),
        0xb7 => "aarch64".into(),
        _ => "unknown".into(),
    }
}

fn tool_dependencies(path: &Path) -> Result<Vec<String>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_TOOL_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.starts_with(b"#!") {
        let dependency = String::from_utf8_lossy(&bytes[..bytes.len().min(256)])
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        return Ok((!dependency.is_empty())
            .then_some(dependency)
            .into_iter()
            .collect());
    }
    Ok(vec![])
}

fn checksum(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
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
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn listening_ports(value: &str) -> BTreeSet<u16> {
    value
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.get(3).copied() != Some("0A") {
                return None;
            }
            fields
                .get(1)
                .and_then(|local| local.rsplit(':').next())
                .and_then(|port| u16::from_str_radix(port, 16).ok())
                .filter(|port| *port > 0)
        })
        .collect()
}

fn container_ip(runtime: &Runtime, container: &str) -> Result<IpAddr, String> {
    let output = runtime.exec_capture(&[
        "inspect".into(),
        "--format".into(),
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}".into(),
        container.into(),
    ])?;
    let ip = output
        .trim()
        .parse()
        .map_err(|error| format!("sandbox network address unavailable: {error}"))?;
    if !preview_target_allowed(ip, true) {
        return Err("sandbox preview target rejected by network policy".into());
    }
    Ok(ip)
}

fn preview_target_allowed(ip: IpAddr, is_container_target: bool) -> bool {
    if is_loopback_or_special(ip) {
        return false;
    }
    if is_private_host_range(ip) {
        return is_container_target;
    }
    true
}

fn is_loopback_or_special(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (octets[0] == 169 && octets[1] == 254)
                || octets[0] == 0
        }
        IpAddr::V6(address) => {
            let segments = address.segments();
            address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_private_host_range(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            let octets = address.octets();
            octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        IpAddr::V6(address) => (address.segments()[0] & 0xfe00) == 0xfc00,
    }
}

impl PortForwarder {
    fn new(ip: IpAddr, container_port: u16) -> Result<Self, String> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .map_err(|error| format!("sandbox preview port unavailable: {error}"))?;
        let host_port = listener
            .local_addr()
            .map_err(|error| format!("sandbox preview address unavailable: {error}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("sandbox preview listener unavailable: {error}"))?;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let thread_stop = stop.clone();
        let target = SocketAddr::from((ip, container_port));
        let thread = thread::spawn(move || {
            while !thread_stop.load(std::sync::atomic::Ordering::Relaxed) {
                match listener.accept() {
                    Ok((client, _)) => {
                        let stop = thread_stop.clone();
                        thread::spawn(move || bridge(client, target, stop));
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            host_port,
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for PortForwarder {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn bridge(mut client: TcpStream, target: SocketAddr, stop: Arc<std::sync::atomic::AtomicBool>) {
    let Ok(mut server) = TcpStream::connect_timeout(&target, Duration::from_secs(3)) else {
        return;
    };
    let _ = client.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = server.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = client.set_write_timeout(Some(Duration::from_secs(1)));
    let _ = server.set_write_timeout(Some(Duration::from_secs(1)));
    let Ok(mut reverse_client) = client.try_clone() else {
        return;
    };
    let Ok(mut reverse_server) = server.try_clone() else {
        return;
    };
    let forward = thread::spawn(move || {
        let _ = io::copy(&mut client, &mut server);
    });
    let _ = io::copy(&mut reverse_server, &mut reverse_client);
    let _ = forward.join();
    let _ = stop;
}

#[tauri::command]
pub fn sandbox_destroy(
    state: tauri::State<'_, crate::AppState>,
    sandbox_id: String,
) -> Result<(), String> {
    state.sandboxes.destroy(&sandbox_id)
}

#[tauri::command]
pub fn sandbox_ports(
    state: tauri::State<'_, crate::AppState>,
    sandbox_id: String,
) -> Result<Vec<SandboxPort>, String> {
    state.sandboxes.refresh_ports(&sandbox_id)
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
        capability, cleanup_headless_session, command_for, create_headless_session,
        first_command_name, headless_command, headless_tokens, is_headless_workspace_name,
        is_loopback_or_special, is_private_host_range, is_sandbox_workspace_name, listening_ports,
        normalize_cwd, preview_target_allowed, should_reap_orphan, should_reap_session,
        stale_timestamp, workspace_size, HeadlessSession, HostToolEntry, Runtime, SandboxSession,
        IDLE_TTL, IMAGE, SANDBOX_LABEL,
    };
    use std::collections::{HashMap, HashSet};
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
    fn finds_first_executable_name() {
        assert_eq!(
            first_command_name("FOO=bar python script.py"),
            Some("python".into())
        );
        assert_eq!(
            first_command_name("env NODE_ENV=test npm run dev"),
            Some("npm".into())
        );
        assert_eq!(first_command_name("/usr/bin/rg --files"), Some("rg".into()));
    }

    #[test]
    fn parses_listening_ports() {
        let value =
            "sl local_address rem_address st\n  1: 0100007F:1F90 00000000:0000 0A 0:0 0:0\n";
        assert!(listening_ports(value).contains(&8080));
    }

    #[test]
    fn maps_lazy_capabilities() {
        assert_eq!(capability("python").map(|item| item.name()), Some("python"));
        assert_eq!(capability("cargo").map(|item| item.name()), Some("rust"));
        assert_eq!(capability("ffmpeg").map(|item| item.name()), Some("ffmpeg"));
        assert!(capability("node").is_none());
    }

    #[test]
    fn keeps_host_tool_cache_metadata() {
        let entry = HostToolEntry {
            name: "rg".into(),
            executable: "/cache/rg".into(),
            version: "14.1.0".into(),
            architecture: "x86_64".into(),
            checksum: "deadbeef".into(),
            dependencies: vec!["libc.so.6".into()],
            import_strategy: "copy-executable".into(),
        };
        let value = serde_json::to_value(entry).unwrap();
        for key in [
            "name",
            "executable",
            "version",
            "architecture",
            "checksum",
            "dependencies",
            "importStrategy",
        ] {
            assert!(value.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn only_reaps_old_container_timestamps() {
        let old = (chrono::Utc::now() - chrono::Duration::days(2)).to_rfc3339();
        assert!(stale_timestamp(&old));
        assert!(!stale_timestamp("not-a-timestamp"));
        assert!(should_reap_orphan(
            "crashed",
            "current",
            false,
            "not-a-timestamp"
        ));
        assert!(should_reap_orphan("crashed", "current", true, &old));
        assert!(!should_reap_orphan("current", "current", true, &old));
        assert!(!should_reap_orphan(
            "another",
            "current",
            true,
            "not-a-timestamp"
        ));
    }

    #[test]
    fn accepts_only_exact_sandbox_workspace_names() {
        let name = "polyui-sandbox-0123456789abcdef0123456789abcdef";
        assert!(is_sandbox_workspace_name(name));
        assert!(!is_sandbox_workspace_name("polyui-sandbox-other"));
        assert!(!is_sandbox_workspace_name(&format!("{name}-copy")));
    }

    #[test]
    fn workspace_usage_stops_at_limit() {
        let directory = std::env::temp_dir().join(format!("polyui-size-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("file"), b"x").unwrap();
        let usage = workspace_size(&directory, 0).unwrap();
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(usage, 1);
    }

    #[test]
    fn active_pty_blocks_idle_reaping() {
        let mut session = SandboxSession {
            container: "polyui-sandbox-test".into(),
            workspace: PathBuf::from("/tmp/polyui-sandbox-test"),
            runtime: Runtime {
                program: PathBuf::from("/usr/bin/docker"),
            },
            capabilities: HashSet::new(),
            imported: HashSet::new(),
            forwarders: HashMap::new(),
            last_activity: Instant::now() - IDLE_TTL - Duration::from_secs(1),
            active_commands: 0,
        };
        assert!(should_reap_session(&session));
        session.active_commands = 1;
        assert!(!should_reap_session(&session));
    }

    #[test]
    fn headless_runner_allows_fixed_read_only_commands() {
        let session = create_headless_session().unwrap();
        let result = (|| {
            for command in ["pwd", "ls -la", "cat relative-file", "git status --short"] {
                let plan = headless_command(&session, "/workspace", command)
                    .unwrap()
                    .expect(command);
                assert!(plan.headless);
                assert!(plan.cwd.as_ref().unwrap().starts_with(&session.root));
                assert!(plan
                    .env
                    .iter()
                    .all(|(key, _)| key != "POLYUI_API_KEY" && key != "OPENAI_API_KEY"));
                assert!(plan
                    .args
                    .iter()
                    .all(|argument| !argument.contains(session.root.to_string_lossy().as_ref())));
            }
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
                    headless_command(&session, "/workspace", command)
                        .unwrap()
                        .is_none(),
                    "{command}"
                );
            }
            Ok::<(), String>(())
        })();
        let cleanup = cleanup_headless_session(session);
        assert!(cleanup.is_ok(), "headless cleanup failed: {cleanup:?}");
        result.unwrap();
    }

    #[test]
    fn headless_parser_rejects_shell_syntax() {
        for command in ["echo $(whoami)", "echo `whoami`", "ls && pwd", "cat a;b"] {
            assert!(headless_tokens(command).is_none(), "{command}");
        }
    }

    #[test]
    fn headless_workspaces_use_exact_names() {
        assert!(is_headless_workspace_name(
            "polyui-headless-0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_headless_workspace_name("polyui-headless-other"));
        assert!(!is_headless_workspace_name(
            "polyui-headless-0123456789abcdef0123456789abcdef-copy"
        ));
    }

    #[test]
    fn active_headless_pty_blocks_idle_reaping() {
        let mut session = HeadlessSession {
            root: PathBuf::from("/tmp/polyui-headless-test"),
            last_activity: Instant::now() - IDLE_TTL - Duration::from_secs(1),
            active_commands: 0,
        };
        assert!(super::should_reap_headless_session(&session));
        session.active_commands = 1;
        assert!(!super::should_reap_headless_session(&session));
    }

    #[test]
    fn blocks_preview_targets_that_can_reach_the_host() {
        for address in [
            "127.0.0.1",
            "0.0.0.0",
            "169.254.169.254",
            "10.0.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "::1",
            "fe80::1",
            "fd00::1",
        ] {
            let ip = address.parse().unwrap();
            assert!(is_loopback_or_special(ip) || is_private_host_range(ip));
            assert!(!preview_target_allowed(ip, false));
        }
        assert!(preview_target_allowed("172.17.0.2".parse().unwrap(), true));
        assert!(!preview_target_allowed(
            "172.17.0.2".parse().unwrap(),
            false
        ));
        assert!(preview_target_allowed("8.8.8.8".parse().unwrap(), false));
    }

    #[test]
    fn builds_ai_commands_inside_runtime_only() {
        let session = SandboxSession {
            container: "polyui-sandbox-test".into(),
            workspace: PathBuf::from("/tmp/polyui-sandbox-test"),
            runtime: Runtime {
                program: PathBuf::from("/usr/bin/docker"),
            },
            capabilities: HashSet::new(),
            imported: HashSet::new(),
            forwarders: HashMap::new(),
            last_activity: Instant::now(),
            active_commands: 0,
        };
        let command = command_for(&session, "/workspace", "printf ok");
        assert_eq!(command.program, PathBuf::from("/usr/bin/docker"));
        assert!(command
            .args
            .windows(2)
            .any(|args| { args[0] == "--user" && args[1] == "sandbox" }));
        assert!(command.args.iter().any(|arg| arg == "polyui-sandbox-test"));
        assert!(command.args.iter().any(|arg| arg == "/bin/bash"));
        assert!(!command.headless);
        assert!(command.cwd.is_none());
        assert!(command.env.is_empty());
        assert!(!command
            .args
            .iter()
            .any(|arg| arg.contains("new_default_prog")));
        assert!(!command
            .args
            .iter()
            .any(|arg| arg.contains("/home/squeegee")));
    }

    #[test]
    fn sandbox_e2e_lifecycle() {
        if std::env::var("POLYUI_SANDBOX_E2E").as_deref() != Ok("1") {
            return;
        }
        let runtime = super::discover_runtime().expect("Docker or Podman is required");
        let info = runtime
            .exec_output(&["info".into()])
            .expect("container runtime should start");
        if !info.status.success() {
            return;
        }

        let mut session =
            super::create_session(&runtime, "polyui-e2e", &|_| {}).expect("sandbox should create");
        let container = session.container.clone();
        let orphan = format!("polyui-sandbox-orphan-{}", uuid::Uuid::new_v4().simple());
        let cache_dir =
            std::env::temp_dir().join(format!("polyui-e2e-cache-{}", uuid::Uuid::new_v4()));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            (|| {
                let output = runtime.exec_capture(&[
                    "exec".into(),
                    "--user".into(),
                    "sandbox".into(),
                    container.clone(),
                    "/bin/bash".into(),
                    "-lc".into(),
                    "printf sandbox-ok; pwd".into(),
                ])?;
                assert!(output.contains("sandbox-ok"));
                assert!(output.contains("/workspace"));

                runtime.checked(&[
                    "run".into(),
                    "--detach".into(),
                    "--name".into(),
                    orphan.clone(),
                    "--label".into(),
                    SANDBOX_LABEL.into(),
                    "--label".into(),
                    "io.polyui.owner=crashed-test".into(),
                    IMAGE.into(),
                    "sleep".into(),
                    "infinity".into(),
                ])?;
                runtime.checked(&["stop".into(), orphan.clone()])?;
                let active = runtime.reap_orphans("polyui-e2e-current")?;
                assert!(!active.contains(&orphan));
                let remaining = runtime.exec_capture(&[
                    "ps".into(),
                    "--all".into(),
                    "--quiet".into(),
                    "--filter".into(),
                    format!("name=^{orphan}$"),
                ])?;
                assert!(remaining.trim().is_empty());

                std::fs::create_dir(&cache_dir).map_err(|error| error.to_string())?;
                let mut cache = super::HostToolCache::load(cache_dir.join("index.json"));
                super::ensure_command_ready(
                    &mut session,
                    &mut cache,
                    "python3 -c 'print(7)'",
                    &|_| {},
                )?;
                let python = runtime.exec_capture(&[
                    "exec".into(),
                    "--user".into(),
                    "sandbox".into(),
                    container.clone(),
                    "/bin/bash".into(),
                    "-lc".into(),
                    "export PATH=/opt/poly-tools/bin:/usr/local/bin:/usr/bin:/bin; python3 -c 'print(7)'"
                        .into(),
                ])?;
                assert!(python.contains('7'));

                let metadata = runtime.exec_capture(&[
                    "inspect".into(),
                    "--format".into(),
                    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}".into(),
                    container.clone(),
                ])?;
                let ip: std::net::IpAddr = metadata
                    .trim()
                    .parse::<std::net::IpAddr>()
                    .map_err(|error| error.to_string())?;
                assert!(super::preview_target_allowed(ip, true));
                runtime.checked(&[
                "exec".into(),
                "--user".into(),
                "sandbox".into(),
                container.clone(),
                "/bin/sh".into(),
                "-lc".into(),
                "node -e \"require('http').createServer((_, response) => response.end('ok')).listen(4173, '0.0.0.0')\" >/tmp/polyui-e2e.log 2>&1 & echo $! >/tmp/polyui-e2e.pid".into(),
            ])?;
                std::thread::sleep(Duration::from_millis(250));
                let ports = runtime.exec_capture(&[
                    "exec".into(),
                    "--user".into(),
                    "sandbox".into(),
                    container.clone(),
                    "/bin/sh".into(),
                    "-lc".into(),
                    "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null".into(),
                ])?;
                assert!(super::listening_ports(&ports).contains(&4173));
                runtime.checked(&[
                "exec".into(),
                "--user".into(),
                "sandbox".into(),
                container.clone(),
                "/bin/sh".into(),
                "-lc".into(),
                "/bin/kill \"$(cat /tmp/polyui-e2e.pid)\" 2>/dev/null || true; rm -f /tmp/polyui-e2e.pid /tmp/polyui-e2e.log".into(),
            ])?;
                Ok::<(), String>(())
            })()
        }));
        let _ = runtime.checked(&["rm".into(), "--force".into(), orphan]);
        let cleanup = super::cleanup_session(session);
        let _ = std::fs::remove_dir_all(cache_dir);
        assert!(cleanup.is_ok(), "sandbox cleanup failed: {cleanup:?}");
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => panic!("sandbox smoke failed: {error}"),
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }
}
