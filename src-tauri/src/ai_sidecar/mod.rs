mod process;
mod protocol;

use process::{resolve_executable, SidecarProcess};
pub use protocol::AiRuntimeEvent;
use protocol::SidecarRecord;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncBufReadExt;
use tokio::sync::{broadcast, oneshot, Mutex};

type Pending = oneshot::Sender<Result<serde_json::Value, String>>;

struct State {
    process: Option<SidecarProcess>,
    generation: u64,
}

pub struct AiSidecar {
    app: AppHandle,
    executable: PathBuf,
    state: Arc<Mutex<State>>,
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    active: Arc<Mutex<HashSet<String>>>,
    events: broadcast::Sender<AiRuntimeEvent>,
}

impl AiSidecar {
    pub fn new(app: &AppHandle) -> Result<Arc<Self>, String> {
        let (events, _) = broadcast::channel(256);
        Ok(Arc::new(Self {
            app: app.clone(),
            executable: resolve_executable(app)?,
            state: Arc::new(Mutex::new(State {
                process: None,
                generation: 0,
            })),
            pending: Arc::new(Mutex::new(HashMap::new())),
            active: Arc::new(Mutex::new(HashSet::new())),
            events,
        }))
    }

    pub async fn start_stream(
        &self,
        request_id: &str,
        command: serde_json::Value,
    ) -> Result<(), String> {
        self.active.lock().await.insert(request_id.to_string());
        if let Err(error) = self.send(command).await {
            self.active.lock().await.remove(request_id);
            return Err(error);
        }
        Ok(())
    }

    pub async fn request(
        &self,
        request_id: &str,
        command: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(request_id.to_string(), sender);
        if let Err(error) = self.send(command).await {
            self.pending.lock().await.remove(request_id);
            return Err(error);
        }
        tokio::time::timeout(std::time::Duration::from_secs(30), receiver)
            .await
            .map_err(|_| "AI runtime request timed out".to_string())?
            .map_err(|_| "AI runtime stopped before replying".to_string())?
    }

    /// Fire-and-forget relay for one-way messages (e.g. PTY output routed back
    /// from the host). Unlike `request`, nothing waits for a reply.
    pub async fn forward(&self, command: serde_json::Value) -> Result<(), String> {
        let kind = command
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        crate::startup_log::log_event(format!("AI PTY relay send: {kind}"));
        let result = self.send(command).await;
        if let Err(error) = &result {
            crate::startup_log::log_error(format!("AI PTY relay send failed: {error}"));
        }
        result
    }

    pub async fn cancel(&self, request_id: &str) -> Result<(), String> {
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
        if let Some(process) = self.state.lock().await.process.take() {
            process.terminate().await;
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AiRuntimeEvent> {
        self.events.subscribe()
    }

    async fn send(&self, command: serde_json::Value) -> Result<(), String> {
        let mut state = self.state.lock().await;
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

    async fn spawn_locked(&self, state: &mut State) -> Result<(), String> {
        let (process, mut stdout) = SidecarProcess::spawn(&self.executable).await?;
        state.generation += 1;
        let generation = state.generation;
        state.process = Some(process);
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
                    Ok(0) | Err(_) => break,
                    Ok(_) => match serde_json::from_str::<SidecarRecord>(line.trim_end()) {
                        Ok(record) => route_record(&app, &pending, &active, &events, record).await,
                        Err(error) => log::error!("invalid AI runtime envelope: {error}"),
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

async fn route_record(
    app: &AppHandle,
    pending: &Mutex<HashMap<String, Pending>>,
    active: &Mutex<HashSet<String>>,
    events: &broadcast::Sender<AiRuntimeEvent>,
    record: SidecarRecord,
) {
    match record {
        SidecarRecord::Ready => {}
        SidecarRecord::Chunk { request_id, chunk } => {
            let event = AiRuntimeEvent::Chunk { request_id, chunk };
            let _ = events.send(event.clone());
            let _ = app.emit("ai-runtime-event", event);
        }
        SidecarRecord::Done { request_id } => {
            active.lock().await.remove(&request_id);
            let event = AiRuntimeEvent::Done { request_id };
            let _ = events.send(event.clone());
            let _ = app.emit("ai-runtime-event", event);
        }
        SidecarRecord::Result { request_id, result } => {
            if let Some(sender) = pending.lock().await.remove(&request_id) {
                let _ = sender.send(Ok(result));
            }
        }
        SidecarRecord::Error { request_id, error } => {
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
            if level == "error" {
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
