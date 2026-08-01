use crate::models::chat::ChatMessage;
use crate::AppState;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePairingInfo {
    pub url: String,
    pub http_base_url: String,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub device_connected: bool,
}

pub struct MobilePairingState {
    current: Mutex<Option<MobilePairingSession>>,
}

struct MobilePairingSession {
    info: MobilePairingInfo,
    stop: oneshot::Sender<()>,
    last_device_seen: Arc<Mutex<Option<Instant>>>,
}

impl Default for MobilePairingState {
    fn default() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn mobile_pairing_start(
    state: State<'_, MobilePairingState>,
    app_state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<MobilePairingInfo, String> {
    let mut current = state.current.lock().await;
    if let Some(session) = current.as_ref() {
        return Ok(session.info.clone());
    }

    let host = lan_ip().unwrap_or(Ipv4Addr::LOCALHOST).to_string();
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|error| format!("Failed to start mobile pairing: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read pairing port: {error}"))?
        .port();
    let token = Uuid::new_v4().to_string();
    let info = build_pairing_info(&host, port, &token);
    let last_device_seen = Arc::new(Mutex::new(None));
    let jobs = Arc::new(Mutex::new(HashMap::new()));
    let (stop_tx, stop_rx) = oneshot::channel();

    tokio::spawn(run_pairing_server(
        listener,
        token,
        app_state.db.clone(),
        app_state.secret_store.clone(),
        app_state.ai.clone(),
        app_handle,
        Arc::clone(&last_device_seen),
        jobs,
        stop_rx,
    ));
    *current = Some(MobilePairingSession {
        info: info.clone(),
        stop: stop_tx,
        last_device_seen,
    });

    Ok(info)
}

#[tauri::command]
pub async fn mobile_pairing_stop(state: State<'_, MobilePairingState>) -> Result<(), String> {
    let mut current = state.current.lock().await;
    if let Some(session) = current.take() {
        let _ = session.stop.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn mobile_pairing_status(
    state: State<'_, MobilePairingState>,
) -> Result<Option<MobilePairingInfo>, String> {
    let current = state.current.lock().await;
    let Some(session) = current.as_ref() else {
        return Ok(None);
    };
    let mut info = session.info.clone();
    info.device_connected = device_is_connected(*session.last_device_seen.lock().await);
    Ok(Some(info))
}

fn build_pairing_info(host: &str, port: u16, token: &str) -> MobilePairingInfo {
    let http_base_url = format!("http://{host}:{port}");
    let url = format!("{http_base_url}/mobile.html?token={token}");
    MobilePairingInfo {
        url,
        http_base_url,
        host: host.to_string(),
        port,
        token: token.to_string(),
        device_connected: false,
    }
}

const DEVICE_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_HTTP_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MOBILE_JOB_TTL: Duration = Duration::from_secs(10 * 60);
const SSE_HEARTBEAT: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct MobileJobEvent {
    name: String,
    data: String,
}

#[derive(Clone)]
enum MobileJobOutcome {
    Running,
    Done(String),
    Error(String),
}

struct MobileJob {
    conversation_id: Option<String>,
    content: String,
    pending_approval: Option<String>,
    outcome: MobileJobOutcome,
    updated_at: Instant,
    events: tokio::sync::broadcast::Sender<MobileJobEvent>,
}

impl MobileJob {
    fn new(conversation_id: Option<String>) -> Self {
        let (events, _) = tokio::sync::broadcast::channel(256);
        Self {
            conversation_id,
            content: String::new(),
            pending_approval: None,
            outcome: MobileJobOutcome::Running,
            updated_at: Instant::now(),
            events,
        }
    }

    fn publish(&mut self, name: &str, data: String) {
        if name == "chunk" {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&data) {
                self.content
                    .push_str(value["content"].as_str().unwrap_or_default());
            }
            self.pending_approval = None;
        } else if matches!(name, "reasoning" | "activity") {
            self.pending_approval = None;
        } else if name == "approval" {
            self.pending_approval = Some(data.clone());
        } else if name == "done" {
            self.pending_approval = None;
            self.outcome = MobileJobOutcome::Done(data.clone());
        } else if name == "error" {
            self.pending_approval = None;
            self.outcome = MobileJobOutcome::Error(data.clone());
        }
        self.updated_at = Instant::now();
        let _ = self.events.send(MobileJobEvent {
            name: name.to_string(),
            data,
        });
    }
}

type MobileJobs = Arc<Mutex<HashMap<String, MobileJob>>>;

fn should_cancel_job_on_client_disconnect() -> bool {
    false
}

fn device_is_connected(last_seen: Option<Instant>) -> bool {
    last_seen.is_some_and(|value| value.elapsed() < DEVICE_TIMEOUT)
}

fn lan_ip() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

const AUTH_FAILURE_WINDOW: Duration = Duration::from_secs(60);
const MAX_AUTH_FAILURES: u32 = 10;

/// Throttles token guessing: after MAX_AUTH_FAILURES bad tokens within the
/// window, unauthorized requests get 429 until the window resets. Requests
/// carrying the correct token are never blocked.
/// ponytail: one global bucket; per-IP buckets if a noisy LAN device ever
/// starves legitimate pairing attempts.
struct AuthRateLimiter {
    failures: u32,
    window_start: Instant,
}

impl AuthRateLimiter {
    fn new() -> Self {
        Self {
            failures: 0,
            window_start: Instant::now(),
        }
    }

    /// Records a failed auth attempt; returns true once locked out.
    fn record_failure(&mut self) -> bool {
        if self.window_start.elapsed() > AUTH_FAILURE_WINDOW {
            self.failures = 0;
            self.window_start = Instant::now();
        }
        self.failures = self.failures.saturating_add(1);
        self.failures > MAX_AUTH_FAILURES
    }
}

async fn run_pairing_server(
    listener: TcpListener,
    token: String,
    db: sqlx::SqlitePool,
    secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
    ai: Arc<crate::ai_sidecar::AiSidecar>,
    app_handle: tauri::AppHandle,
    last_device_seen: Arc<Mutex<Option<Instant>>>,
    jobs: MobileJobs,
    mut stop: oneshot::Receiver<()>,
) {
    let token = Arc::new(token);
    let limiter = Arc::new(std::sync::Mutex::new(AuthRateLimiter::new()));
    loop {
        tokio::select! {
            _ = &mut stop => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                let token = Arc::clone(&token);
                let limiter = Arc::clone(&limiter);
                let db = db.clone();
                let secret_store = secret_store.clone();
                let ai = ai.clone();
                let app_handle = app_handle.clone();
                let last_device_seen = Arc::clone(&last_device_seen);
                let jobs = Arc::clone(&jobs);
                tokio::spawn(async move {
                    let _ = handle_connection(
                        stream,
                        token.as_str(),
                        limiter,
                        db,
                        secret_store,
                        ai,
                        app_handle,
                        last_device_seen,
                        jobs,
                    )
                    .await;
                });
            }
        }
    }
}

#[derive(Deserialize)]
struct BrowserChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    conversation_id: Option<String>,
    is_temporary: Option<bool>,
    provider_type: Option<String>,
    provider_config_id: Option<i64>,
    connection_id: Option<String>,
    runtime: Option<crate::runtime::RuntimeRef>,
}

#[derive(Deserialize)]
struct BrowserApprovalRequest {
    request_id: String,
    approval_id: String,
    approved: bool,
}

#[derive(Deserialize)]
struct BrowserCancelRequest {
    request_id: String,
}

fn parse_cancel_request(body: &str) -> Result<BrowserCancelRequest, String> {
    let mut request =
        serde_json::from_str::<BrowserCancelRequest>(body).map_err(|error| error.to_string())?;
    request.request_id = request.request_id.trim().to_string();
    if request.request_id.is_empty() {
        return Err("Request ID is required.".to_string());
    }
    Ok(request)
}

#[derive(Deserialize)]
struct BrowserConversationRequest {
    id: String,
    title: String,
    is_temporary: Option<bool>,
}

#[derive(Deserialize)]
struct BrowserConversationEditRequest {
    id: String,
    title: Option<String>,
}

fn parse_conversation_edit(
    body: &str,
    require_title: bool,
) -> Result<BrowserConversationEditRequest, String> {
    let mut request = serde_json::from_str::<BrowserConversationEditRequest>(body)
        .map_err(|error| error.to_string())?;
    request.id = request.id.trim().to_string();
    if request.id.is_empty() {
        return Err("Conversation ID is required.".to_string());
    }
    if require_title {
        let title = request.title.as_deref().unwrap_or_default().trim();
        if title.is_empty() {
            return Err("Conversation title is required.".to_string());
        }
        if title.chars().count() > 200 {
            return Err("Conversation title is too long.".to_string());
        }
        request.title = Some(title.to_string());
    }
    Ok(request)
}

#[derive(Deserialize)]
struct BrowserMessageRequest {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    model: Option<String>,
    provider: Option<String>,
    is_temporary: Option<bool>,
}

#[derive(Deserialize)]
struct PushTokenRequest {
    token: String,
    environment: String,
}

fn parse_push_token_request(body: &str) -> Result<PushTokenRequest, String> {
    let request =
        serde_json::from_str::<PushTokenRequest>(body).map_err(|error| error.to_string())?;
    crate::mobile_push::validate_registration(&request.token, &request.environment)?;
    Ok(request)
}

async fn read_http_request(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    tokio::time::timeout(REQUEST_READ_TIMEOUT, async {
        let mut request = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            let read = stream.read(&mut chunk).await?;
            if read == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "HTTP request ended before its body was complete",
                ));
            }
            request.extend_from_slice(&chunk[..read]);
            if request.len() > MAX_HTTP_REQUEST_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "HTTP request is too large",
                ));
            }
            let Some(expected_len) = expected_http_request_len(&request)? else {
                continue;
            };
            if expected_len > MAX_HTTP_REQUEST_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "HTTP request is too large",
                ));
            }
            if request.len() >= expected_len {
                request.truncate(expected_len);
                return Ok(request);
            }
        }
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "HTTP request timed out"))?
}

fn expected_http_request_len(request: &[u8]) -> std::io::Result<Option<usize>> {
    let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };
    let headers = std::str::from_utf8(&request[..header_end]).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "HTTP headers are not UTF-8",
        )
    })?;
    let content_length = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>())
        .transpose()
        .map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid Content-Length header",
            )
        })?
        .unwrap_or(0);
    Ok(Some(
        header_end
            .checked_add(4)
            .and_then(|length| length.checked_add(content_length))
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "HTTP request length overflow",
                )
            })?,
    ))
}

async fn handle_connection(
    mut stream: TcpStream,
    token: &str,
    limiter: Arc<std::sync::Mutex<AuthRateLimiter>>,
    db: sqlx::SqlitePool,
    secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
    ai: Arc<crate::ai_sidecar::AiSidecar>,
    app_handle: tauri::AppHandle,
    last_device_seen: Arc<Mutex<Option<Instant>>>,
    jobs: MobileJobs,
) -> std::io::Result<()> {
    let request = read_http_request(&mut stream).await?;
    let request = String::from_utf8_lossy(&request);
    let first_line = request.lines().next().unwrap_or("GET / HTTP/1.1");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");
    let body = request.split("\r\n\r\n").nth(1).unwrap_or("");
    if !token_matches(path, token) && !is_public_path(path) {
        let locked_out = limiter
            .lock()
            .map(|mut limiter| limiter.record_failure())
            .unwrap_or(false);
        if locked_out {
            stream.write_all(&too_many_requests_response()).await?;
            return Ok(());
        }
    }
    if method == "POST" && path.starts_with("/api/presence") && token_matches(path, token) {
        *last_device_seen.lock().await = Some(Instant::now());
    }
    if method == "POST" && path.starts_with("/api/chat-stream") {
        return handle_chat_stream_response(
            stream,
            path,
            body,
            token,
            db,
            secret_store,
            ai,
            app_handle,
            jobs,
        )
        .await;
    }
    if method == "GET" && path.starts_with("/api/job-stream") {
        return handle_job_stream_response(stream, path, token, jobs).await;
    }
    let response = response_for_request(
        method,
        path,
        body,
        token,
        db,
        secret_store,
        ai,
        app_handle,
        jobs,
    )
    .await;
    stream.write_all(&response).await
}

async fn handle_chat_stream_response(
    mut stream: TcpStream,
    path: &str,
    body: &str,
    token: &str,
    db: sqlx::SqlitePool,
    secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
    ai: Arc<crate::ai_sidecar::AiSidecar>,
    app_handle: tauri::AppHandle,
    jobs: MobileJobs,
) -> std::io::Result<()> {
    if !token_matches(path, token) {
        stream.write_all(&unauthorized_response()).await?;
        return Ok(());
    }
    stream
        .write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n",
        )
        .await?;

    let request = match serde_json::from_str::<BrowserChatRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            write_sse(
                &mut stream,
                "error",
                &serde_json::json!({ "error": error.to_string() }).to_string(),
            )
            .await?;
            return finish_sse(&mut stream).await;
        }
    };
    let reservation_id = Uuid::new_v4().to_string();
    {
        let mut jobs = jobs.lock().await;
        jobs.retain(|_, job| job.updated_at.elapsed() < MOBILE_JOB_TTL);
        jobs.insert(
            reservation_id.clone(),
            MobileJob::new(request.conversation_id.clone()),
        );
    }
    let (provider_type, request_id, mut events, mut runtime) =
        match start_mobile_chat(&db, secret_store.as_ref(), &ai, &request).await {
            Ok(started) => started,
            Err(error) => {
                jobs.lock().await.remove(&reservation_id);
                write_sse(
                    &mut stream,
                    "error",
                    &serde_json::json!({ "error": error }).to_string(),
                )
                .await?;
                return finish_sse(&mut stream).await;
            }
        };

    {
        let mut jobs = jobs.lock().await;
        let job = jobs
            .remove(&reservation_id)
            .unwrap_or_else(|| MobileJob::new(request.conversation_id.clone()));
        jobs.insert(request_id.clone(), job);
    }
    let mut client_connected = write_sse(
        &mut stream,
        "started",
        &serde_json::json!({ "requestId": request_id }).to_string(),
    )
    .await
    .is_ok();

    let mut content = String::new();
    let mut completed = false;
    let mut failure = None;
    let mut heartbeat = tokio::time::interval(SSE_HEARTBEAT);
    loop {
        let event = tokio::select! {
            _ = heartbeat.tick() => {
                if client_connected && write_sse(&mut stream, "ping", "{}").await.is_err() {
                    client_connected = false;
                }
                continue;
            }
            event = events.recv() => match event {
                Ok(event) => event,
                Err(_) => {
                    let _ = ai.cancel(&request_id).await;
                    failure = Some("AI event stream closed.".to_string());
                    break;
                }
            }
        };
        match event {
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id && chunk["type"] == "text-delta" => {
                let delta = chunk["delta"].as_str().unwrap_or_default();
                content.push_str(delta);
                publish_mobile_job(
                    &jobs,
                    &request_id,
                    "chunk",
                    serde_json::json!({ "content": delta }).to_string(),
                )
                .await;
                if client_connected {
                    if let Err(error) = write_sse(
                        &mut stream,
                        "chunk",
                        &serde_json::json!({ "content": delta }).to_string(),
                    )
                    .await
                    {
                        client_connected = false;
                        if should_cancel_job_on_client_disconnect() {
                            let _ = ai.cancel(&request_id).await;
                            return Err(error);
                        }
                    }
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id && chunk["type"] == "reasoning-delta" => {
                let delta = chunk["delta"].as_str().unwrap_or_default();
                publish_mobile_job(
                    &jobs,
                    &request_id,
                    "reasoning",
                    serde_json::json!({ "content": delta }).to_string(),
                )
                .await;
                if client_connected {
                    if let Err(error) = write_sse(
                        &mut stream,
                        "reasoning",
                        &serde_json::json!({ "content": delta }).to_string(),
                    )
                    .await
                    {
                        client_connected = false;
                        if should_cancel_job_on_client_disconnect() {
                            let _ = ai.cancel(&request_id).await;
                            return Err(error);
                        }
                    }
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id
                && chunk["type"] == "data-agent"
                && chunk["data"]["kind"] == "permission"
                && chunk["data"]["status"] == "pending" =>
            {
                let approval = serde_json::json!({
                    "requestId": request_id,
                    "approvalId": chunk["data"]["approvalId"],
                    "action": chunk["data"]["action"],
                    "command": chunk["data"]["command"],
                    "paths": chunk["data"]["paths"],
                    "cwd": chunk["data"]["cwd"],
                });
                publish_mobile_job(&jobs, &request_id, "approval", approval.to_string()).await;

                if let (Some(conversation_id), Some(approval_id)) = (
                    request.conversation_id.clone(),
                    chunk["data"]["approvalId"].as_str().map(str::to_string),
                ) {
                    let push_db = db.clone();
                    let action = chunk["data"]["action"]
                        .as_str()
                        .unwrap_or("Approval required")
                        .to_string();
                    let command = chunk["data"]["command"].as_str().map(str::to_string);
                    let paths = chunk["data"]["paths"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|path| path.as_str().map(str::to_string))
                        .collect::<Vec<_>>();
                    let cwd = chunk["data"]["cwd"].as_str().map(str::to_string);
                    let push_request_id = request_id.clone();
                    tokio::spawn(async move {
                        if let Err(error) = crate::mobile_push::notify_approval_requested(
                            &push_db,
                            &conversation_id,
                            &push_request_id,
                            &approval_id,
                            &action,
                            command.as_deref(),
                            &paths,
                            cwd.as_deref(),
                        )
                        .await
                        {
                            log::warn!("Approval push failed: {error}");
                        }
                    });
                }

                if client_connected {
                    if write_sse(&mut stream, "approval", &approval.to_string())
                        .await
                        .is_err()
                    {
                        client_connected = false;
                    }
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id
                && chunk["type"] == "data-agent"
                && matches!(
                    chunk["data"]["kind"].as_str(),
                    Some("plan" | "task" | "terminal" | "file")
                ) =>
            {
                let activity = serde_json::json!({
                    "kind": chunk["data"]["kind"],
                    "status": chunk["data"]["status"],
                    "text": chunk["data"]["text"],
                    "command": chunk["data"]["command"],
                    "paths": chunk["data"]["paths"],
                    "cwd": chunk["data"]["cwd"],
                });
                publish_mobile_job(&jobs, &request_id, "activity", activity.to_string()).await;
                if client_connected
                    && write_sse(&mut stream, "activity", &activity.to_string())
                        .await
                        .is_err()
                {
                    client_connected = false;
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id && chunk["type"] == "finish" => {
                if let (
                    Some(session_id),
                    Some(crate::runtime::RuntimeRef::CodingAgent {
                        agent_session_id, ..
                    }),
                ) = (
                    chunk["messageMetadata"]["agentSessionId"].as_str(),
                    runtime.as_mut(),
                ) {
                    *agent_session_id = Some(session_id.to_string());
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Chunk {
                request_id: id,
                chunk,
            } if id == request_id && chunk["type"] == "data-runtime-result" => {
                if let Some(final_text) = chunk["data"]["text"]
                    .as_str()
                    .filter(|text| !text.is_empty())
                {
                    content = final_text.to_string();
                }
            }
            crate::ai_sidecar::AiRuntimeEvent::Error {
                request_id: id,
                error,
            } if id == request_id => {
                failure = Some(error);
                break;
            }
            crate::ai_sidecar::AiRuntimeEvent::Done { request_id: id } if id == request_id => {
                completed = true;
                break;
            }
            _ => {}
        }
    }

    if completed && !request.is_temporary.unwrap_or(false) {
        if let (Some(conversation_id), Some(runtime)) =
            (request.conversation_id.as_deref(), runtime.as_ref())
        {
            if let Err(error) = crate::connections::repository::set_conversation_runtime(
                &db,
                conversation_id,
                runtime,
            )
            .await
            {
                log::warn!("Failed to save mobile runtime session: {error}");
            }
        }
    }

    let assistant_id = Uuid::new_v4().to_string();
    if !request.is_temporary.unwrap_or(false) {
        if let Some(conversation_id) = request.conversation_id.as_deref() {
            let message = BrowserMessageRequest {
                id: assistant_id.clone(),
                conversation_id: conversation_id.to_string(),
                role: "assistant".to_string(),
                content: content.clone(),
                model: Some(request.model),
                provider: Some(provider_type.clone()),
                is_temporary: Some(false),
            };
            match insert_message(&db, &message).await {
                Ok(()) => {
                    emit_mobile_chat_updated(&app_handle, Some(conversation_id));
                    if completed {
                        let push_db = db.clone();
                        let push_conversation_id = conversation_id.to_string();
                        tokio::spawn(async move {
                            if let Err(error) = crate::mobile_push::notify_agent_completed(
                                &push_db,
                                &push_conversation_id,
                            )
                            .await
                            {
                                log::warn!("Agent completion push failed: {error}");
                            }
                        });
                    }
                }
                Err(error) => log::error!("Failed to persist mobile assistant message: {error}"),
            }
        }
    }
    let (event, data) = if let Some(error) = failure {
        ("error", serde_json::json!({ "error": error }).to_string())
    } else {
        (
            "done",
            serde_json::json!({ "id": assistant_id, "content": content, "provider": provider_type })
                .to_string(),
        )
    };
    publish_mobile_job(&jobs, &request_id, event, data.clone()).await;
    if client_connected {
        write_sse(&mut stream, event, &data).await?;
        finish_sse(&mut stream).await?;
    }
    Ok(())
}

async fn publish_mobile_job(jobs: &MobileJobs, request_id: &str, name: &str, data: String) {
    if let Some(job) = jobs.lock().await.get_mut(request_id) {
        job.publish(name, data);
    }
}

async fn handle_job_stream_response(
    mut stream: TcpStream,
    path: &str,
    token: &str,
    jobs: MobileJobs,
) -> std::io::Result<()> {
    if !token_matches(path, token) {
        stream.write_all(&unauthorized_response()).await?;
        return Ok(());
    }
    stream
        .write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n",
        )
        .await?;

    let request_id = query_value(path, "requestId").unwrap_or_default();
    let (content, pending_approval, outcome, mut events) = {
        let mut jobs = jobs.lock().await;
        jobs.retain(|_, job| job.updated_at.elapsed() < MOBILE_JOB_TTL);
        let Some(job) = jobs.get(&request_id) else {
            write_sse(
                &mut stream,
                "error",
                r#"{"error":"Mobile job was not found."}"#,
            )
            .await?;
            return finish_sse(&mut stream).await;
        };
        (
            job.content.clone(),
            job.pending_approval.clone(),
            job.outcome.clone(),
            job.events.subscribe(),
        )
    };

    write_sse(
        &mut stream,
        "snapshot",
        &serde_json::json!({ "content": content }).to_string(),
    )
    .await?;
    match outcome {
        MobileJobOutcome::Done(data) => {
            write_sse(&mut stream, "done", &data).await?;
            return finish_sse(&mut stream).await;
        }
        MobileJobOutcome::Error(data) => {
            write_sse(&mut stream, "error", &data).await?;
            return finish_sse(&mut stream).await;
        }
        MobileJobOutcome::Running => {}
    }
    if let Some(approval) = pending_approval {
        write_sse(&mut stream, "approval", &approval).await?;
    }

    let mut heartbeat = tokio::time::interval(SSE_HEARTBEAT);
    loop {
        tokio::select! {
            _ = heartbeat.tick() => write_sse(&mut stream, "ping", "{}").await?,
            event = events.recv() => {
                let event = match event {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let (snapshot, pending_approval, outcome) = jobs
                            .lock()
                            .await
                            .get(&request_id)
                            .map(|job| (
                                job.content.clone(),
                                job.pending_approval.clone(),
                                job.outcome.clone(),
                            ))
                            .unwrap_or((String::new(), None, MobileJobOutcome::Running));
                        write_sse(
                            &mut stream,
                            "snapshot",
                            &serde_json::json!({ "content": snapshot }).to_string(),
                        ).await?;
                        match outcome {
                            MobileJobOutcome::Done(data) => {
                                write_sse(&mut stream, "done", &data).await?;
                                return finish_sse(&mut stream).await;
                            }
                            MobileJobOutcome::Error(data) => {
                                write_sse(&mut stream, "error", &data).await?;
                                return finish_sse(&mut stream).await;
                            }
                            MobileJobOutcome::Running => {
                                if let Some(approval) = pending_approval {
                                    write_sse(&mut stream, "approval", &approval).await?;
                                }
                                continue;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                write_sse(&mut stream, &event.name, &event.data).await?;
                if matches!(event.name.as_str(), "done" | "error") {
                    break;
                }
            }
        }
    }
    finish_sse(&mut stream).await
}

async fn start_mobile_chat(
    db: &sqlx::SqlitePool,
    secret_store: &dyn crate::connections::secrets::SecretStore,
    ai: &crate::ai_sidecar::AiSidecar,
    request: &BrowserChatRequest,
) -> Result<
    (
        String,
        String,
        tokio::sync::broadcast::Receiver<crate::ai_sidecar::AiRuntimeEvent>,
        Option<crate::runtime::RuntimeRef>,
    ),
    String,
> {
    let _ = (&request.provider_type, request.provider_config_id);
    let request_id = Uuid::new_v4().to_string();
    let events = ai.subscribe();
    let messages = request
        .messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "role": message.role,
                "parts": [{ "type": "text", "text": message.content }],
            })
        })
        .collect::<Vec<_>>();
    let mut runtime = request.runtime.clone();
    if let (
        Some(conversation_id),
        Some(crate::runtime::RuntimeRef::CodingAgent {
            installation_id,
            agent_kind,
            workspace_id,
            agent_session_id: None,
        }),
    ) = (request.conversation_id.as_deref(), runtime.clone())
    {
        if let Some(existing) =
            crate::connections::repository::get_conversation_runtime(db, conversation_id).await?
        {
            let matches = matches!(
                &existing,
                crate::runtime::RuntimeRef::CodingAgent {
                    installation_id: existing_installation,
                    agent_kind: existing_kind,
                    workspace_id: existing_workspace,
                    agent_session_id: Some(_),
                } if existing_installation == &installation_id
                    && existing_kind == &agent_kind
                    && existing_workspace == &workspace_id
            );
            if matches {
                runtime = Some(existing);
            }
        }
    }
    let provider_type = match runtime.as_ref() {
        Some(crate::runtime::RuntimeRef::CodingAgent {
            installation_id,
            agent_kind,
            workspace_id,
            agent_session_id,
        }) => {
            if installation_id != agent_kind.as_str() {
                return Err("Coding agent installation is invalid.".to_string());
            }
            let conversation_id = request
                .conversation_id
                .as_deref()
                .ok_or_else(|| "Coding agents require a conversation.".to_string())?;
            let workspace = crate::connections::repository::get_workspace(db, workspace_id)
                .await?
                .ok_or_else(|| "Workspace was not found.".to_string())?;
            if !Path::new(&workspace.path).is_dir() {
                return Err("Workspace directory is unavailable.".to_string());
            }
            let status =
                crate::commands::agent_commands::agent_cli_status(agent_kind.as_str().to_string())
                    .await?;
            if !status.installed || !status.authenticated {
                return Err(format!("{} is not ready on desktop.", request.model));
            }
            ai.start_stream(
                &request_id,
                serde_json::json!({
                    "type": "agent",
                    "requestId": request_id,
                    "conversationId": conversation_id,
                    "agent": {
                        "kind": agent_kind.as_str(),
                        "workspace": workspace.path,
                        "accessMode": "workspace-write",
                        "executablePath": status.executable,
                        "sessionId": agent_session_id,
                    },
                    "messages": messages,
                    "reasoning": "medium",
                }),
            )
            .await?;
            agent_kind.as_str().to_string()
        }
        Some(crate::runtime::RuntimeRef::Unresolved { .. }) => {
            return Err("Select an available runtime.".to_string())
        }
        selected => {
            let (connection, model) = match selected {
                Some(crate::runtime::RuntimeRef::ChatModel {
                    connection_id,
                    model_id,
                }) => (
                    crate::connections::repository::get_connection(db, connection_id)
                        .await?
                        .ok_or_else(|| format!("Connection {connection_id} was not found."))?,
                    model_id.clone(),
                ),
                _ if request.connection_id.is_some() => {
                    let connection_id = request.connection_id.as_deref().unwrap_or_default();
                    (
                        crate::connections::repository::get_connection(db, connection_id)
                            .await?
                            .ok_or_else(|| format!("Connection {connection_id} was not found."))?,
                        request.model.clone(),
                    )
                }
                _ if request.conversation_id.is_some() => {
                    let conversation_id = request.conversation_id.as_deref().unwrap_or_default();
                    match crate::connections::repository::get_conversation_runtime(
                        db,
                        conversation_id,
                    )
                    .await?
                    {
                        Some(crate::runtime::RuntimeRef::ChatModel {
                            connection_id,
                            model_id,
                        }) => (
                            crate::connections::repository::get_connection(db, &connection_id)
                                .await?
                                .ok_or_else(|| {
                                    format!("Connection {connection_id} was not found.")
                                })?,
                            model_id,
                        ),
                        _ => resolve_unique_mobile_connection(db, &request.model).await?,
                    }
                }
                _ => resolve_unique_mobile_connection(db, &request.model).await?,
            };
            let provider_type = legacy_provider_type(&connection.provider).to_string();
            ai.start_stream(
                &request_id,
                serde_json::json!({
                    "type": "chat",
                    "requestId": request_id,
                    "conversationId": request.conversation_id,
                    "connection": crate::commands::ai_runtime_commands::sidecar_connection(
                        secret_store,
                        &connection,
                        Some(&model),
                        None,
                    )?,
                    "messages": messages,
                    "reasoning": "medium",
                    "collectText": true,
                }),
            )
            .await?;
            provider_type
        }
    };
    if !request.is_temporary.unwrap_or(false) {
        if let (Some(conversation_id), Some(runtime)) =
            (request.conversation_id.as_deref(), runtime.as_ref())
        {
            crate::connections::repository::set_conversation_runtime(db, conversation_id, runtime)
                .await?;
        }
    }
    Ok((provider_type, request_id, events, runtime))
}

async fn resolve_unique_mobile_connection(
    db: &sqlx::SqlitePool,
    model: &str,
) -> Result<(crate::connections::Connection, String), String> {
    let mut matches = Vec::new();
    for connection in crate::connections::repository::list_enabled_connections(db).await? {
        if crate::connections::repository::model_exists(db, &connection.id, model).await? {
            matches.push(connection);
        }
    }
    match matches.len() {
        1 => Ok((matches.remove(0), model.to_string())),
        0 => Err(format!(
            "No enabled connection offers model {model}. Refresh models first."
        )),
        _ => Err(format!(
            "More than one connection offers model {model}. Select a connection."
        )),
    }
}

async fn list_mobile_runtimes(db: &sqlx::SqlitePool) -> Result<serde_json::Value, String> {
    let mut choices = Vec::new();
    for connection in crate::connections::repository::list_enabled_connections(db).await? {
        let group = if matches!(
            connection.provider,
            crate::connections::Provider::Ollama | crate::connections::Provider::Lmstudio
        ) {
            "Local models"
        } else {
            "Cloud models"
        };
        for model in crate::connections::repository::list_models(db, &connection.id)
            .await?
            .into_iter()
            .filter(|model| model.enabled)
        {
            choices.push(serde_json::json!({
                "id": format!("model:{}:{}", connection.id, model.remote_id),
                "kind": "chat-model",
                "group": group,
                "label": model.display_name.clone().unwrap_or_else(|| model.remote_id.clone()),
                "detail": connection.display_name,
                "available": true,
                "providerType": legacy_provider_type(&connection.provider),
                "runtime": crate::runtime::RuntimeRef::ChatModel {
                    connection_id: connection.id.clone(),
                    model_id: model.remote_id,
                },
            }));
        }
    }

    let owner_id = mobile_owner_account_id(db).await?;
    let workspaces = crate::connections::repository::list_workspaces(db, &owner_id).await?;
    let (codex, claude) = tokio::join!(
        crate::commands::agent_commands::agent_cli_status("codex".to_string()),
        crate::commands::agent_commands::agent_cli_status("claude-code".to_string()),
    );
    for (kind, label, status) in [
        (crate::runtime::AgentKind::Codex, "Codex", codex),
        (crate::runtime::AgentKind::ClaudeCode, "Claude Code", claude),
    ] {
        let ready = status
            .as_ref()
            .is_ok_and(|status| status.installed && status.authenticated);
        if workspaces.is_empty() {
            choices.push(serde_json::json!({
                "id": format!("agent:{}", kind.as_str()),
                "kind": "coding-agent",
                "group": "Coding agents",
                "label": label,
                "detail": "Choose a workspace on desktop",
                "available": false,
                "providerType": null,
                "runtime": null,
            }));
            continue;
        }
        for workspace in &workspaces {
            let workspace_ready = !matches!(
                workspace.availability,
                crate::connections::WorkspaceAvailability::Missing
            ) && Path::new(&workspace.path).is_dir();
            choices.push(serde_json::json!({
                "id": format!("agent:{}:{}", kind.as_str(), workspace.id),
                "kind": "coding-agent",
                "group": "Coding agents",
                "label": label,
                "detail": if ready { workspace.display_name.as_str() } else { "Not ready on desktop" },
                "available": ready && workspace_ready,
                "providerType": null,
                "runtime": crate::runtime::RuntimeRef::CodingAgent {
                    installation_id: kind.as_str().to_string(),
                    agent_kind: kind,
                    workspace_id: workspace.id.clone(),
                    agent_session_id: None,
                },
            }));
        }
    }
    Ok(serde_json::Value::Array(choices))
}

fn legacy_provider_type(provider: &crate::connections::Provider) -> &'static str {
    match provider {
        crate::connections::Provider::Anthropic => "AnthropicNative",
        crate::connections::Provider::Gemini => "GeminiNative",
        crate::connections::Provider::Ollama => "OllamaLocal",
        _ => "OpenAICompatible",
    }
}

async fn write_sse(stream: &mut TcpStream, event: &str, data: &str) -> std::io::Result<()> {
    stream.write_all(&sse_chunk(event, data)).await?;
    stream.flush().await
}

fn sse_chunk(event: &str, data: &str) -> Vec<u8> {
    let body = format!("event: {event}\ndata: {data}\n\n");
    format!("{:X}\r\n{body}\r\n", body.len()).into_bytes()
}

async fn finish_sse(stream: &mut TcpStream) -> std::io::Result<()> {
    stream.write_all(b"0\r\n\r\n").await
}

async fn response_for_request(
    method: &str,
    path: &str,
    body: &str,
    token: &str,
    db: sqlx::SqlitePool,
    secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
    ai: Arc<crate::ai_sidecar::AiSidecar>,
    app_handle: tauri::AppHandle,
    jobs: MobileJobs,
) -> Vec<u8> {
    if let Some(response) = response_for_static_path(method, path, token) {
        return response;
    }
    if !token_matches(path, token) {
        return unauthorized_response();
    }

    if method == "GET" && path.starts_with("/api/status") {
        return json_response(200, r#"{"ok":true,"app":"PolyUI"}"#);
    }

    if method == "POST" && path.starts_with("/api/presence") {
        return json_response(200, r#"{"ok":true}"#);
    }

    if method == "GET" && path.starts_with("/api/runtimes") {
        let body = match list_mobile_runtimes(&db).await {
            Ok(runtimes) => serde_json::json!({ "ok": true, "runtimes": runtimes }).to_string(),
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "POST" && path.starts_with("/api/approval") {
        let request = match serde_json::from_str::<BrowserApprovalRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
                )
            }
        };
        let result = ai
            .approval(
                &request.request_id,
                &request.approval_id,
                request.approved,
                None,
            )
            .await;
        return match result {
            Ok(()) => {
                if let Some(job) = jobs.lock().await.get_mut(&request.request_id) {
                    job.pending_approval = None;
                }
                json_response(200, r#"{"ok":true}"#)
            }
            Err(error) => json_response(
                400,
                &serde_json::json!({ "ok": false, "error": error }).to_string(),
            ),
        };
    }

    if method == "POST" && path.starts_with("/api/cancel") {
        let request = match parse_cancel_request(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
                )
            }
        };
        return match ai.cancel(&request.request_id).await {
            Ok(()) => json_response(200, r#"{"ok":true}"#),
            Err(error) => json_response(
                400,
                &serde_json::json!({ "ok": false, "error": error }).to_string(),
            ),
        };
    }

    if matches!(method, "POST" | "DELETE") && path.starts_with("/api/push-token") {
        let request = match parse_push_token_request(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error }).to_string(),
                )
            }
        };
        let result = if method == "POST" {
            crate::mobile_push::register_token(&db, &request.token, &request.environment).await
        } else {
            crate::mobile_push::unregister_token(&db, &request.token).await
        };
        return match result {
            Ok(()) => json_response(200, r#"{"ok":true}"#),
            Err(error) => json_response(
                500,
                &serde_json::json!({ "ok": false, "error": error }).to_string(),
            ),
        };
    }

    if method == "GET" && path.starts_with("/api/models") {
        let connections = crate::connections::repository::list_enabled_connections(&db).await;
        let body = match connections {
            Ok(connections) => {
                let mut choices = Vec::new();
                for connection in connections {
                    let provider_type = legacy_provider_type(&connection.provider);
                    for model in crate::connections::repository::list_models(&db, &connection.id)
                        .await
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|model| model.enabled)
                    {
                        choices.push(serde_json::json!({
                            "name": model.remote_id,
                            "providerType": provider_type,
                            "providerConfigId": null,
                            "connectionId": connection.id,
                        }));
                    }
                }
                serde_json::json!({ "ok": true, "models": choices }).to_string()
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "GET" && path.starts_with("/api/conversations") {
        let body = match list_conversations(&db).await {
            Ok(conversations) => {
                serde_json::json!({ "ok": true, "conversations": conversations }).to_string()
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "POST" && path.starts_with("/api/conversations") {
        let request = match serde_json::from_str::<BrowserConversationRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
                )
            }
        };
        if request.is_temporary.unwrap_or(false) {
            return json_response(200, r#"{"ok":true}"#);
        }
        let owner_id = mobile_owner_account_id(&db).await.unwrap_or_default();
        let result = sqlx::query("INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived, userId, folderId) VALUES (?1, ?2, datetime('now'), datetime('now'), 0, ?3, NULL) ON CONFLICT(id) DO NOTHING")
            .bind(&request.id)
            .bind(&request.title)
            .bind(owner_id)
            .execute(&db)
            .await;
        let body = match result {
            Ok(inserted) => {
                if inserted.rows_affected() > 0 {
                    emit_mobile_chat_updated(&app_handle, None);
                }
                r#"{"ok":true}"#.to_string()
            }
            Err(error) => {
                serde_json::json!({ "ok": false, "error": error.to_string() }).to_string()
            }
        };
        return json_response(200, &body);
    }

    if method == "PATCH" && path.starts_with("/api/conversations") {
        let request = match parse_conversation_edit(body, true) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error }).to_string(),
                )
            }
        };
        let result = sqlx::query("UPDATE conversations SET title = ?1 WHERE id = ?2")
            .bind(request.title.unwrap_or_default())
            .bind(&request.id)
            .execute(&db)
            .await;
        return match result {
            Ok(updated) if updated.rows_affected() > 0 => {
                emit_mobile_chat_updated(&app_handle, Some(&request.id));
                json_response(200, r#"{"ok":true}"#)
            }
            Ok(_) => json_response(404, r#"{"ok":false,"error":"Conversation was not found."}"#),
            Err(error) => json_response(
                500,
                &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
            ),
        };
    }

    if method == "DELETE" && path.starts_with("/api/conversations") {
        let request = match parse_conversation_edit(body, false) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error }).to_string(),
                )
            }
        };
        let has_active_job = jobs.lock().await.values().any(|job| {
            job.conversation_id.as_deref() == Some(request.id.as_str())
                && matches!(&job.outcome, MobileJobOutcome::Running)
        });
        if has_active_job {
            return json_response(
                409,
                r#"{"ok":false,"error":"Stop the active response before deleting this chat."}"#,
            );
        }
        let result = async {
            let mut transaction = db.begin().await.map_err(|error| error.to_string())?;
            sqlx::query("DELETE FROM messages WHERE conversationId = ?1")
                .bind(&request.id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
            let deleted = sqlx::query("DELETE FROM conversations WHERE id = ?1")
                .bind(&request.id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
            transaction
                .commit()
                .await
                .map_err(|error| error.to_string())?;
            Ok::<_, String>(deleted.rows_affected())
        }
        .await;
        return match result {
            Ok(removed) if removed > 0 => {
                emit_mobile_chat_updated(&app_handle, Some(&request.id));
                json_response(200, r#"{"ok":true}"#)
            }
            Ok(_) => json_response(404, r#"{"ok":false,"error":"Conversation was not found."}"#),
            Err(error) => json_response(
                500,
                &serde_json::json!({ "ok": false, "error": error }).to_string(),
            ),
        };
    }

    if method == "GET" && path.starts_with("/api/messages") {
        let conversation_id = query_value(path, "conversationId").unwrap_or_default();
        let body = match list_messages(&db, &conversation_id).await {
            Ok(messages) => serde_json::json!({ "ok": true, "messages": messages }).to_string(),
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "POST" && path.starts_with("/api/messages") {
        let request = match serde_json::from_str::<BrowserMessageRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
                )
            }
        };
        if request.is_temporary.unwrap_or(false) {
            return json_response(200, r#"{"ok":true}"#);
        }
        let result = insert_message(&db, &request).await;
        let body = match result {
            Ok(_) => {
                emit_mobile_chat_updated(&app_handle, Some(&request.conversation_id));
                r#"{"ok":true}"#.to_string()
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "POST" && path.starts_with("/api/chat") {
        let request = match serde_json::from_str::<BrowserChatRequest>(body) {
            Ok(request) => request,
            Err(error) => {
                return json_response(
                    400,
                    &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
                )
            }
        };
        let body = match start_mobile_chat(&db, secret_store.as_ref(), &ai, &request).await {
            Ok((provider_type, request_id, mut events, _runtime)) => {
                let mut content = String::new();
                let mut failure = None;
                while let Ok(event) = events.recv().await {
                    match event {
                        crate::ai_sidecar::AiRuntimeEvent::Chunk {
                            request_id: id,
                            chunk,
                        } if id == request_id && chunk["type"] == "data-runtime-result" => {
                            content = chunk["data"]["text"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string();
                        }
                        crate::ai_sidecar::AiRuntimeEvent::Error {
                            request_id: id,
                            error,
                        } if id == request_id => {
                            failure = Some(error);
                            break;
                        }
                        crate::ai_sidecar::AiRuntimeEvent::Done { request_id: id }
                            if id == request_id =>
                        {
                            break
                        }
                        _ => {}
                    }
                }
                if let Some(error) = failure {
                    serde_json::json!({ "ok": false, "error": error }).to_string()
                } else {
                    if !request.is_temporary.unwrap_or(false) {
                        if let Some(conversation_id) = request.conversation_id.as_deref() {
                            let message = BrowserMessageRequest {
                                id: Uuid::new_v4().to_string(),
                                conversation_id: conversation_id.to_string(),
                                role: "assistant".to_string(),
                                content: content.clone(),
                                model: Some(request.model.clone()),
                                provider: Some(provider_type.clone()),
                                is_temporary: Some(false),
                            };
                            let _ = insert_message(&db, &message).await;
                            emit_mobile_chat_updated(&app_handle, Some(conversation_id));
                        }
                    }
                    serde_json::json!({ "ok": true, "message": { "role": "assistant", "content": content, "provider": provider_type } }).to_string()
                }
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    not_found_response()
}

#[cfg(test)]
fn response_for_path(path: &str, token: &str) -> String {
    String::from_utf8_lossy(
        &response_for_static_path("GET", path, token).unwrap_or_else(unauthorized_response),
    )
    .into_owned()
}

fn response_for_static_path(method: &str, path: &str, token: &str) -> Option<Vec<u8>> {
    if method != "GET" {
        return None;
    }
    if path == "/health" {
        return Some(json_response(200, r#"{"ok":true,"app":"PolyUI"}"#));
    }

    if path == "/polyui-icon.png" {
        return Some(serve_public_file("polyui-icon.png"));
    }

    let expected = format!("/pair/verify?token={token}");
    if path == expected {
        return Some(json_response(200, r#"{"ok":true,"app":"PolyUI"}"#));
    }

    if path.starts_with("/mobile.html?") && token_matches(path, token) {
        return Some(serve_dist_file("mobile.html"));
    }

    if path.starts_with("/assets/") {
        return Some(serve_dist_file(path.trim_start_matches('/')));
    }

    None
}

fn token_matches(path: &str, token: &str) -> bool {
    path.split_once('?')
        .map(|(_, query)| {
            url::form_urlencoded::parse(query.as_bytes())
                .any(|(key, value)| key == "token" && value == token)
        })
        .unwrap_or(false)
}

fn query_value(path: &str, name: &str) -> Option<String> {
    path.split_once('?').and_then(|(_, query)| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileChatUpdatedPayload {
    conversation_id: Option<String>,
}

fn emit_mobile_chat_updated(app_handle: &tauri::AppHandle, conversation_id: Option<&str>) {
    let _ = app_handle.emit(
        "mobile-chat-updated",
        MobileChatUpdatedPayload {
            conversation_id: conversation_id.map(str::to_string),
        },
    );
}

async fn list_conversations(db: &sqlx::SqlitePool) -> Result<serde_json::Value, String> {
    let rows = sqlx::query("SELECT id, title, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt) AS createdAt, strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt) AS updatedAt, isArchived, folderId, runtime_kind, runtime_ref FROM conversations ORDER BY updatedAt DESC")
        .fetch_all(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(serde_json::Value::Array(
        rows.into_iter()
            .map(|row| {
                let runtime = match (
                    row.try_get::<String, _>("runtime_kind").ok(),
                    row.try_get::<String, _>("runtime_ref").ok(),
                ) {
                    (Some(kind), Some(payload)) => {
                        crate::runtime::RuntimeRef::from_columns(&kind, &payload).ok()
                    }
                    _ => None,
                };
                serde_json::json!({
                    "id": row.get::<String, _>("id"),
                    "title": row.get::<String, _>("title"),
                    "createdAt": row.get::<String, _>("createdAt"),
                    "updatedAt": row.get::<String, _>("updatedAt"),
                    "isArchived": row.get::<i64, _>("isArchived") != 0,
                    "folderId": row.try_get::<String, _>("folderId").ok(),
                    "runtime": runtime,
                })
            })
            .collect(),
    ))
}

async fn mobile_owner_account_id(db: &sqlx::SqlitePool) -> Result<String, String> {
    if let Ok(row) = sqlx::query("SELECT account_id FROM connections WHERE account_id <> '' ORDER BY updated_at DESC LIMIT 1")
        .fetch_one(db)
        .await
    {
        return Ok(row.get::<String, _>("account_id"));
    }
    if let Ok(row) = sqlx::query(
        "SELECT userId FROM conversations WHERE userId <> '' ORDER BY updatedAt DESC LIMIT 1",
    )
    .fetch_one(db)
    .await
    {
        return Ok(row.get::<String, _>("userId"));
    }
    Ok(String::new())
}

async fn list_messages(
    db: &sqlx::SqlitePool,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    let rows = sqlx::query("SELECT id, conversationId, role, content, strftime('%Y-%m-%dT%H:%M:%fZ', createdAt) AS createdAt, model, provider, status, errorMessage FROM messages WHERE conversationId = ?1 ORDER BY createdAt ASC")
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(serde_json::Value::Array(
        rows.into_iter()
            .map(|row| {
                serde_json::json!({
                    "id": row.get::<String, _>("id"),
                    "conversationId": row.get::<String, _>("conversationId"),
                    "role": row.get::<String, _>("role"),
                    "content": row.get::<String, _>("content"),
                    "createdAt": row.get::<String, _>("createdAt"),
                    "model": row.try_get::<String, _>("model").ok(),
                    "provider": row.try_get::<String, _>("provider").ok(),
                    "status": row.try_get::<String, _>("status").ok(),
                    "errorMessage": row.try_get::<String, _>("errorMessage").ok(),
                })
            })
            .collect(),
    ))
}

async fn insert_message(
    db: &sqlx::SqlitePool,
    message: &BrowserMessageRequest,
) -> Result<(), String> {
    let owner_id = mobile_owner_account_id(db).await.unwrap_or_default();
    if !owner_id.is_empty() {
        let _ = sqlx::query("UPDATE conversations SET userId = ?1 WHERE id = ?2 AND (userId IS NULL OR userId = '')")
            .bind(&owner_id)
            .bind(&message.conversation_id)
            .execute(db)
            .await;
    }
    sqlx::query("INSERT INTO messages (id, conversationId, role, content, createdAt, attachments, model, provider, thinking, thinkingDuration, webSearch, status, errorMessage) VALUES (?1, ?2, ?3, ?4, datetime('now'), NULL, ?5, ?6, NULL, NULL, NULL, 'complete', NULL)")
        .bind(&message.id)
        .bind(&message.conversation_id)
        .bind(&message.role)
        .bind(&message.content)
        .bind(&message.model)
        .bind(message.provider.clone())
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("UPDATE conversations SET updatedAt = datetime('now') WHERE id = ?1")
        .bind(&message.conversation_id)
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Paths served without a pairing token; failures here never count toward
/// the auth rate limit.
fn is_public_path(path: &str) -> bool {
    path == "/health" || path == "/polyui-icon.png" || path.starts_with("/assets/")
}

fn unauthorized_response() -> Vec<u8> {
    json_response(401, r#"{"ok":false}"#)
}

fn too_many_requests_response() -> Vec<u8> {
    json_response(429, r#"{"ok":false,"error":"Too many requests"}"#)
}

fn not_found_response() -> Vec<u8> {
    json_response(404, r#"{"ok":false,"error":"Not found"}"#)
}

fn binary_response(content_type: &str, body: &[u8]) -> Vec<u8> {
    let header = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    let mut response = header.into_bytes();
    response.extend_from_slice(body);
    response
}

fn json_response(status: u16, body: &str) -> Vec<u8> {
    http_response(status, "application/json", body)
}

fn http_response(status: u16, content_type: &str, body: &str) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        400 => "Bad Request",
        429 => "Too Many Requests",
        _ => "Error",
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

fn serve_dist_file(relative_path: &str) -> Vec<u8> {
    let Some(path) = dist_file_path(relative_path) else {
        return not_found_response();
    };
    match fs::read(&path) {
        Ok(bytes) => {
            let content_type = content_type_for_path(&path);
            if content_type.starts_with("text/") || content_type == "application/javascript" {
                return http_response(200, content_type, &String::from_utf8_lossy(&bytes));
            }
            binary_response(content_type, &bytes)
        }
        Err(_) => not_found_response(),
    }
}

fn serve_public_file(relative_path: &str) -> Vec<u8> {
    let clean = relative_path.trim_start_matches('/');
    if clean.contains("..") {
        return not_found_response();
    }
    let roots = public_roots();
    let Some(path) = roots
        .into_iter()
        .map(|root| root.join(clean))
        .find(|path| path.is_file())
    else {
        return not_found_response();
    };
    match fs::read(&path) {
        Ok(bytes) => binary_response(content_type_for_path(&path), &bytes),
        Err(_) => not_found_response(),
    }
}

fn dist_file_path(relative_path: &str) -> Option<PathBuf> {
    let clean = relative_path.trim_start_matches('/');
    if clean.contains("..") {
        return None;
    }
    dist_roots()
        .into_iter()
        .map(|root| root.join(clean))
        .find(|path| path.is_file())
}

fn dist_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        roots.push(current.join("dist"));
        roots.push(current.join("..").join("dist"));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dist"),
    );
    roots
}

fn public_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        roots.push(current.join("public"));
        roots.push(current.join("..").join("public"));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public"),
    );
    roots
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript",
        "json" => "application/json",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;
    use std::time::Duration;

    use super::{
        build_pairing_info, is_public_path, read_http_request, response_for_path, sse_chunk,
        AuthRateLimiter, MAX_AUTH_FAILURES,
    };
    use tokio::io::AsyncWriteExt;
    use tokio::net::{TcpListener, TcpStream};

    #[test]
    fn sse_events_use_http_chunk_framing() {
        let body = "event: chunk\ndata: {\"content\":\"Hi\"}\n\n";

        assert_eq!(
            sse_chunk("chunk", r#"{"content":"Hi"}"#),
            format!("{:X}\r\n{body}\r\n", body.len()).into_bytes(),
        );
    }

    #[test]
    fn mobile_job_snapshot_preserves_missed_content() {
        let mut job = super::MobileJob::new(Some("chat-1".to_string()));
        job.publish("chunk", r#"{"content":"hello "}"#.to_string());
        job.publish("chunk", r#"{"content":"world"}"#.to_string());

        assert_eq!(job.content, "hello world");
        assert!(matches!(job.outcome, super::MobileJobOutcome::Running));
        job.publish("approval", r#"{"approvalId":"approval-1"}"#.to_string());
        assert!(job.pending_approval.is_some());
        job.publish("activity", r#"{"kind":"task"}"#.to_string());
        assert!(job.pending_approval.is_none());
    }

    #[tokio::test]
    async fn reads_http_body_split_across_tcp_packets() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let sender = tokio::spawn(async move {
            let mut client = TcpStream::connect(address).await.unwrap();
            client
                .write_all(b"POST /api/messages HTTP/1.1\r\ncontent-length: 11\r\n\r\n{\"ok\":")
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(20)).await;
            client.write_all(b"true}").await.unwrap();
        });
        let (mut server, _) = listener.accept().await.unwrap();

        let request = read_http_request(&mut server).await.unwrap();

        assert!(String::from_utf8(request)
            .unwrap()
            .ends_with(r#"{"ok":true}"#));
        sender.await.unwrap();
    }

    #[test]
    fn auth_limiter_locks_out_after_max_failures() {
        let mut limiter = AuthRateLimiter::new();
        for _ in 0..MAX_AUTH_FAILURES {
            assert!(!limiter.record_failure());
        }
        assert!(limiter.record_failure());
        assert!(limiter.record_failure());
    }

    #[test]
    fn public_paths_bypass_auth_limiting() {
        assert!(is_public_path("/health"));
        assert!(is_public_path("/polyui-icon.png"));
        assert!(is_public_path("/assets/index-abc.js"));
        assert!(!is_public_path("/api/conversations"));
        assert!(!is_public_path("/mobile.html?token=x"));
    }

    #[test]
    fn pairing_url_opens_vite_mobile_entry() {
        let info = build_pairing_info("192.168.1.20", 3456, "abc");

        assert_eq!(info.http_base_url, "http://192.168.1.20:3456");
        assert_eq!(info.url, "http://192.168.1.20:3456/mobile.html?token=abc");
        assert!(!info.device_connected);
    }

    #[test]
    fn device_presence_expires() {
        assert!(super::device_is_connected(Some(std::time::Instant::now())));
        assert!(!super::device_is_connected(Some(
            std::time::Instant::now() - super::DEVICE_TIMEOUT
        )));
    }

    #[test]
    fn accepts_native_apns_registration() {
        let request = super::parse_push_token_request(
            r#"{"token":"0123456789abcdef0123456789abcdef","environment":"sandbox"}"#,
        )
        .unwrap();

        assert_eq!(request.token, "0123456789abcdef0123456789abcdef");
        assert_eq!(request.environment, "sandbox");
    }

    #[test]
    fn client_disconnect_does_not_cancel_desktop_job() {
        assert!(!super::should_cancel_job_on_client_disconnect());
    }

    #[test]
    fn accepts_coding_agent_runtime() {
        let request = serde_json::from_str::<super::BrowserChatRequest>(
            r#"{"model":"Codex","messages":[],"runtime":{"kind":"coding-agent","installation_id":"codex","agent_kind":"codex","workspace_id":"workspace-1"}}"#,
        )
        .unwrap();

        assert!(matches!(
            request.runtime,
            Some(crate::runtime::RuntimeRef::CodingAgent {
                agent_kind: crate::runtime::AgentKind::Codex,
                workspace_id,
                ..
            }) if workspace_id == "workspace-1"
        ));
    }

    #[test]
    fn cancel_requires_request_id() {
        let request = super::parse_cancel_request(r#"{"request_id":" request-1 "}"#).unwrap();

        assert_eq!(request.request_id, "request-1");
        assert!(super::parse_cancel_request(r#"{"request_id":" "}"#).is_err());
    }

    #[test]
    fn conversation_edits_validate_and_trim() {
        let rename =
            super::parse_conversation_edit(r#"{"id":" chat-1 ","title":" New title "}"#, true)
                .unwrap();

        assert_eq!(rename.id, "chat-1");
        assert_eq!(rename.title.as_deref(), Some("New title"));
        assert!(super::parse_conversation_edit(r#"{"id":"","title":"x"}"#, true).is_err());
        assert!(super::parse_conversation_edit(r#"{"id":"x","title":" "}"#, true).is_err());
    }

    #[test]
    fn mobile_entry_rejects_wrong_token() {
        let response = response_for_path("/mobile.html?token=nope", "abc");

        assert!(response.starts_with("HTTP/1.1 401 Unauthorized"));
    }

    #[test]
    fn verify_accepts_matching_token() {
        let response = response_for_path("/pair/verify?token=abc", "abc");

        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains(r#""ok":true"#));
    }

    #[test]
    fn verify_rejects_wrong_token() {
        let response = response_for_path("/pair/verify?token=nope", "abc");

        assert!(response.starts_with("HTTP/1.1 401 Unauthorized"));
    }
}
