mod process;
mod protocol;

use process::{resolve_executable, SidecarProcess};
pub use protocol::AiRuntimeEvent;
use protocol::SidecarRecord;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncBufReadExt;
use tokio::sync::{broadcast, oneshot, Mutex};

type Pending = oneshot::Sender<Result<serde_json::Value, String>>;

#[derive(Debug, PartialEq, Eq)]
enum WaitError {
    TimedOut,
    Stopped,
}

struct State {
    process: Option<SidecarProcess>,
    generation: u64,
}

fn short_id(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(serde_json::Value::as_str)
        .map(crate::debug_overlay::short_id)
        .unwrap_or_else(|| "-".to_string())
}

fn command_summary(command: &serde_json::Value) -> String {
    let kind = command
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let request_id = short_id(command.get("requestId"));
    let message_count = command
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .map(|messages| messages.len());
    let provider = command
        .get("connection")
        .and_then(|connection| connection.get("provider"))
        .and_then(serde_json::Value::as_str);
    let model = command
        .get("connection")
        .and_then(|connection| connection.get("modelId"))
        .and_then(serde_json::Value::as_str);
    format!(
        "type={kind} request_id={request_id}{}{}{}",
        message_count.map_or(String::new(), |count| format!(" messages={count}")),
        provider.map_or(String::new(), |value| format!(" provider={value}")),
        model.map_or(String::new(), |value| format!(" model={value}")),
    )
}

pub struct AiSidecar {
    app: AppHandle,
    executable: PathBuf,
    state: Arc<Mutex<State>>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    active: Arc<Mutex<HashSet<String>>>,
    events: broadcast::Sender<AiRuntimeEvent>,
    stopping: AtomicBool,
}

impl AiSidecar {
    pub fn new(app: &AppHandle) -> Result<Arc<Self>, String> {
        let (events, _) = broadcast::channel(256);
        let sidecar = Arc::new(Self {
            app: app.clone(),
            executable: resolve_executable(app)?,
            state: Arc::new(Mutex::new(State {
                process: None,
                generation: 0,
            })),
            pending: Arc::new(Mutex::new(HashMap::new())),
            active: Arc::new(Mutex::new(HashSet::new())),
            events,
            stopping: AtomicBool::new(false),
        });
        crate::debug_overlay::emit_dev_log(
            &sidecar.app,
            "info",
            "[dev:ai-sidecar] supervisor initialized",
        );
        Ok(sidecar)
    }

    pub async fn start_stream(
        &self,
        request_id: &str,
        command: serde_json::Value,
    ) -> Result<(), String> {
        self.log(
            "debug",
            format!(
                "stream start request_id={} {}",
                crate::debug_overlay::short_id(request_id),
                command_summary(&command)
            ),
        );
        self.active.lock().await.insert(request_id.to_string());
        if let Err(error) = self.send(command).await {
            self.active.lock().await.remove(request_id);
            self.log(
                "error",
                format!(
                    "stream start failed request_id={}: {error}",
                    crate::debug_overlay::short_id(request_id)
                ),
            );
            return Err(error);
        }
        Ok(())
    }

    pub async fn request(
        &self,
        request_id: &str,
        command: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.log(
            "debug",
            format!(
                "request start request_id={} {}",
                crate::debug_overlay::short_id(request_id),
                command_summary(&command)
            ),
        );
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(request_id.to_string(), sender);
        if let Err(error) = self.send(command).await {
            self.pending.lock().await.remove(request_id);
            return Err(error);
        }
        let result = match wait_for_response(
            &self.pending,
            request_id,
            receiver,
            std::time::Duration::from_secs(30),
        )
        .await
        {
            Ok(result) => result,
            Err(WaitError::Stopped) => Err("AI runtime stopped before replying".into()),
            Err(WaitError::TimedOut) => {
                let _ = self.cancel(request_id).await;
                Err("AI runtime request timed out".into())
            }
        };
        self.log(
            if result.is_ok() { "debug" } else { "error" },
            format!(
                "request complete request_id={} ok={}",
                crate::debug_overlay::short_id(request_id),
                result.is_ok()
            ),
        );
        result
    }

    /// Fire-and-forget relay for one-way messages (e.g. PTY output routed back
    /// from the host). Unlike `request`, nothing waits for a reply.
    pub async fn forward(&self, command: serde_json::Value) -> Result<(), String> {
        let kind = command
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        crate::startup_log::log_event(format!("AI PTY relay send: {kind}"));
        self.log("debug", format!("relay send {kind}"));
        let result = self.send(command).await;
        if let Err(error) = &result {
            crate::startup_log::log_error(format!("AI PTY relay send failed: {error}"));
        }
        result
    }

    pub async fn cancel(&self, request_id: &str) -> Result<(), String> {
        self.log(
            "debug",
            format!(
                "cancel request_id={}",
                crate::debug_overlay::short_id(request_id)
            ),
        );
        self.send(serde_json::json!({ "type": "cancel", "requestId": request_id }))
            .await
    }

    pub async fn approval(
        &self,
        request_id: &str,
        approval_id: &str,
        approved: bool,
        reason: Option<String>,
    ) -> Result<(), String> {
        self.log(
            "debug",
            format!(
                "approval request_id={} approval_id={} approved={approved}",
                crate::debug_overlay::short_id(request_id),
                crate::debug_overlay::short_id(approval_id)
            ),
        );
        self.send(serde_json::json!({
            "type": "approval",
            "requestId": request_id,
            "approvalId": approval_id,
            "approved": approved,
            "reason": reason,
        }))
        .await
    }

    pub async fn shutdown(&self) {
        if self.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        self.log("info", "shutdown requested".to_string());
        if let Some(process) = self.state.lock().await.process.take() {
            process.terminate().await;
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AiRuntimeEvent> {
        self.events.subscribe()
    }

    async fn send(&self, command: serde_json::Value) -> Result<(), String> {
        if self.stopping.load(Ordering::Acquire) {
            return Err("AI runtime is shutting down".into());
        }
        let summary = command_summary(&command);
        let mut state = self.state.lock().await;
        if self.stopping.load(Ordering::Acquire) {
            return Err("AI runtime is shutting down".into());
        }
        if state.process.is_none() {
            self.spawn_locked(&mut state).await?;
        }
        let result = state
            .process
            .as_mut()
            .expect("sidecar started")
            .write(&command)
            .await;
        if result.is_ok() {
            return Ok(());
        }
        self.log("warn", format!("write failed; restarting {summary}"));
        if let Some(process) = state.process.take() {
            process.terminate().await;
        }
        self.spawn_locked(&mut state).await?;
        state
            .process
            .as_mut()
            .expect("sidecar restarted")
            .write(&command)
            .await
    }

    fn log(&self, level: &str, message: String) {
        crate::debug_overlay::emit_dev_log(
            &self.app,
            level,
            &format!("[dev:ai-sidecar] {message}"),
        );
    }

    async fn spawn_locked(&self, state: &mut State) -> Result<(), String> {
        let (process, mut stdout) = SidecarProcess::spawn(&self.executable).await?;
        state.generation += 1;
        let generation = state.generation;
        state.process = Some(process);
        self.log("info", format!("sidecar spawned generation={generation}"));
        let app = self.app.clone();
        let shared_state = self.state.clone();
        let pending = self.pending.clone();
        let active = self.active.clone();
        let events = self.events.clone();
        tauri::async_runtime::spawn(async move {
            let mut line = String::new();
            loop {
                line.clear();
                match stdout.read_line(&mut line).await {
                    Ok(0) => {
                        crate::debug_overlay::emit_dev_log(
                            &app,
                            "warn",
                            "[dev:ai-sidecar] sidecar stdout closed",
                        );
                        break;
                    }
                    Err(error) => {
                        crate::debug_overlay::emit_dev_log(
                            &app,
                            "error",
                            &format!("[dev:ai-sidecar] sidecar stdout read failed: {error}"),
                        );
                        break;
                    }
                    Ok(_) => match serde_json::from_str::<SidecarRecord>(line.trim_end()) {
                        Ok(record) => route_record(&app, &pending, &active, &events, record).await,
                        Err(error) => crate::debug_overlay::emit_dev_log(
                            &app,
                            "error",
                            &format!("[dev:ai-sidecar] invalid runtime envelope: {error}"),
                        ),
                    },
                }
            }
            let mut state = shared_state.lock().await;
            if state.generation == generation {
                state.process.take();
                drop(state);
                fail_all(
                    &app,
                    &pending,
                    &active,
                    &events,
                    "AI runtime stopped unexpectedly",
                )
                .await;
            }
        });
        Ok(())
    }
}

async fn wait_for_response(
    pending: &Mutex<HashMap<String, Pending>>,
    request_id: &str,
    receiver: oneshot::Receiver<Result<serde_json::Value, String>>,
    timeout: std::time::Duration,
) -> Result<Result<serde_json::Value, String>, WaitError> {
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err(WaitError::Stopped),
        Err(_) => {
            pending.lock().await.remove(request_id);
            Err(WaitError::TimedOut)
        }
    }
}

async fn route_record(
    app: &AppHandle,
    pending: &Mutex<HashMap<String, Pending>>,
    active: &Mutex<HashSet<String>>,
    events: &broadcast::Sender<AiRuntimeEvent>,
    record: SidecarRecord,
) {
    match record {
        SidecarRecord::Ready => {
            crate::debug_overlay::emit_dev_log(app, "info", "[dev:ai-sidecar] runtime ready");
        }
        SidecarRecord::Chunk { request_id, chunk } => {
            let event = AiRuntimeEvent::Chunk { request_id, chunk };
            let _ = events.send(event.clone());
            let _ = app.emit("ai-runtime-event", event);
        }
        SidecarRecord::Done { request_id } => {
            crate::debug_overlay::emit_dev_log(
                app,
                "debug",
                &format!(
                    "[dev:ai-sidecar] stream done request_id={}",
                    crate::debug_overlay::short_id(&request_id)
                ),
            );
            active.lock().await.remove(&request_id);
            let event = AiRuntimeEvent::Done { request_id };
            let _ = events.send(event.clone());
            let _ = app.emit("ai-runtime-event", event);
        }
        SidecarRecord::Result { request_id, result } => {
            crate::debug_overlay::emit_dev_log(
                app,
                "debug",
                &format!(
                    "[dev:ai-sidecar] request result request_id={} fields={}",
                    crate::debug_overlay::short_id(&request_id),
                    result.as_object().map_or(0, serde_json::Map::len)
                ),
            );
            if let Some(sender) = pending.lock().await.remove(&request_id) {
                let _ = sender.send(Ok(result));
            }
        }
        SidecarRecord::Error { request_id, error } => {
            crate::debug_overlay::emit_dev_log(
                app,
                "error",
                &format!(
                    "[dev:ai-sidecar] request error request_id={}: {error}",
                    crate::debug_overlay::short_id(&request_id)
                ),
            );
            if let Some(sender) = pending.lock().await.remove(&request_id) {
                let _ = sender.send(Err(error));
            } else {
                active.lock().await.remove(&request_id);
                let event = AiRuntimeEvent::Error { request_id, error };
                let _ = events.send(event.clone());
                let _ = app.emit("ai-runtime-event", event);
            }
        }
        SidecarRecord::Log { level, message } => {
            if cfg!(debug_assertions) {
                crate::debug_overlay::emit_dev_log(
                    app,
                    &level,
                    &format!("[dev:sidecar] {message}"),
                );
            } else if level == "error" {
                log::error!("AI runtime: {message}");
            } else {
                log::warn!("AI runtime: {message}");
            }
        }
    }
}

async fn fail_all(
    app: &AppHandle,
    pending: &Mutex<HashMap<String, Pending>>,
    active: &Mutex<HashSet<String>>,
    events: &broadcast::Sender<AiRuntimeEvent>,
    message: &str,
) {
    crate::debug_overlay::emit_dev_log(
        app,
        "error",
        &format!("[dev:ai-sidecar] failing active requests: {message}"),
    );
    for (_, sender) in pending.lock().await.drain() {
        let _ = sender.send(Err(message.to_string()));
    }
    let request_ids: Vec<String> = active.lock().await.drain().collect();
    for request_id in request_ids {
        let event = AiRuntimeEvent::Error {
            request_id,
            error: message.to_string(),
        };
        let _ = events.send(event.clone());
        let _ = app.emit("ai-runtime-event", event);
    }
}

#[cfg(test)]
mod tests;
