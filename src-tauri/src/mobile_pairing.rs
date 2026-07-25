use crate::models::chat::ChatMessage;
use crate::providers::base::ProviderType;
use crate::providers::factory::ProviderFactory;
use crate::providers::selector::ProviderSelector;
use crate::AppState;
use futures::StreamExt;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Row;
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
}

pub struct MobilePairingState {
    current: Mutex<Option<MobilePairingSession>>,
}

struct MobilePairingSession {
    info: MobilePairingInfo,
    stop: oneshot::Sender<()>,
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
    let (stop_tx, stop_rx) = oneshot::channel();

    tokio::spawn(run_pairing_server(
        listener,
        token,
        app_state.db.clone(),
        app_handle,
        stop_rx,
    ));
    *current = Some(MobilePairingSession {
        info: info.clone(),
        stop: stop_tx,
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
    Ok(state.current.lock().await.as_ref().map(|session| session.info.clone()))
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
    }
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
    app_handle: tauri::AppHandle,
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
                let app_handle = app_handle.clone();
                tokio::spawn(async move {
                    let _ = handle_connection(stream, token.as_str(), limiter, db, app_handle).await;
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
    provider_type: Option<ProviderType>,
    provider_config_id: Option<i64>,
}

#[derive(Deserialize)]
struct BrowserConversationRequest {
    id: String,
    title: String,
    is_temporary: Option<bool>,
}

#[derive(Deserialize)]
struct BrowserMessageRequest {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    model: Option<String>,
    provider: Option<ProviderType>,
    is_temporary: Option<bool>,
}

async fn handle_connection(
    mut stream: TcpStream,
    token: &str,
    limiter: Arc<std::sync::Mutex<AuthRateLimiter>>,
    db: sqlx::SqlitePool,
    app_handle: tauri::AppHandle,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 65_536];
    let read = stream.read(&mut buffer).await?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let first_line = request
        .lines()
        .next()
        .unwrap_or("GET / HTTP/1.1");
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
    if method == "POST" && path.starts_with("/api/chat-stream") {
        return handle_chat_stream_response(stream, path, body, token, db, app_handle).await;
    }
    let response = response_for_request(method, path, body, token, db, app_handle).await;
    stream.write_all(&response).await
}

async fn handle_chat_stream_response(
    mut stream: TcpStream,
    path: &str,
    body: &str,
    token: &str,
    db: sqlx::SqlitePool,
    app_handle: tauri::AppHandle,
) -> std::io::Result<()> {
    if !token_matches(path, token) {
        stream.write_all(&unauthorized_response()).await?;
        return Ok(());
    }
    stream
        .write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n",
        )
        .await?;

    let request = match serde_json::from_str::<BrowserChatRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            write_sse(&mut stream, "error", &serde_json::json!({ "error": error.to_string() }).to_string()).await?;
            return Ok(());
        }
    };
    let provider_type = request.provider_type.unwrap_or(ProviderType::OllamaLocal);
    let provider_result = match request.provider_config_id {
        Some(id) => get_provider_config_by_id(&db, id, provider_type)
            .await
            .and_then(|config| {
                ProviderFactory::create_chat_provider(config)
                    .ok_or_else(|| "Provider configuration is unavailable.".to_string())
            }),
        None => ProviderSelector::new(db.clone()).get_provider(provider_type, None).await,
    };
    let provider = match provider_result {
        Ok(provider) => provider,
        Err(error) => {
            write_sse(&mut stream, "error", &serde_json::json!({ "error": error }).to_string()).await?;
            return Ok(());
        }
    };
    let mut provider_stream = match provider
        .chat_completion(request.model.clone(), request.messages, None, None, None)
        .await
    {
        Ok(stream) => stream,
        Err(error) => {
            write_sse(&mut stream, "error", &serde_json::json!({ "error": error }).to_string()).await?;
            return Ok(());
        }
    };

    let mut content = String::new();
    while let Some(chunk) = provider_stream.next().await {
        match chunk {
            Ok(payload) => {
                if !payload.content.is_empty() {
                    content.push_str(&payload.content);
                    write_sse(
                        &mut stream,
                        "chunk",
                        &serde_json::json!({ "content": payload.content }).to_string(),
                    )
                    .await?;
                }
            }
            Err(error) => {
                write_sse(&mut stream, "error", &serde_json::json!({ "error": error }).to_string()).await?;
                return Ok(());
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
                provider: Some(provider_type),
                is_temporary: Some(false),
            };
            let _ = insert_message(&db, &message).await;
            emit_mobile_chat_updated(&app_handle, Some(conversation_id));
        }
    }
    write_sse(
        &mut stream,
        "done",
        &serde_json::json!({ "id": assistant_id, "content": content, "provider": provider_type }).to_string(),
    )
    .await
}

async fn write_sse(stream: &mut TcpStream, event: &str, data: &str) -> std::io::Result<()> {
    stream
        .write_all(format!("event: {event}\ndata: {data}\n\n").as_bytes())
        .await
}

async fn response_for_request(
    method: &str,
    path: &str,
    body: &str,
    token: &str,
    db: sqlx::SqlitePool,
    app_handle: tauri::AppHandle,
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

    if method == "GET" && path.starts_with("/api/models") {
        let configs = get_all_enabled_provider_configs(&db).await;
        let body = match configs {
            Ok(configs) => {
                let mut choices = Vec::new();
                for config in configs.into_iter().filter(|config| config.enabled) {
                    let provider_models = match ProviderFactory::create_model_catalog(config.clone()) {
                        Some(catalog) => catalog
                            .get_available_models()
                            .await
                            .unwrap_or_default()
                            .into_iter()
                            .map(|model| model.name)
                            .collect::<Vec<_>>(),
                        None => Vec::new(),
                    };
                    let models = if provider_models.is_empty() {
                        config
                            .model_suggestions
                            .as_deref()
                            .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
                            .unwrap_or_default()
                    } else {
                        provider_models
                    };
                    for model in models {
                        choices.push(serde_json::json!({
                            "name": model,
                            "providerType": config.provider_type,
                            "providerConfigId": config.id,
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
            Ok(conversations) => serde_json::json!({ "ok": true, "conversations": conversations }).to_string(),
            Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
        };
        return json_response(200, &body);
    }

    if method == "POST" && path.starts_with("/api/conversations") {
        let request = match serde_json::from_str::<BrowserConversationRequest>(body) {
            Ok(request) => request,
            Err(error) => return json_response(400, &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string()),
        };
        if request.is_temporary.unwrap_or(false) {
            return json_response(200, r#"{"ok":true}"#);
        }
        let owner_id = mobile_owner_account_id(&db).await.unwrap_or_default();
        let result = sqlx::query("INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived, userId, folderId) VALUES (?1, ?2, datetime('now'), datetime('now'), 0, ?3, NULL)")
            .bind(request.id)
            .bind(request.title)
            .bind(owner_id)
            .execute(&db)
            .await;
        let body = match result {
            Ok(_) => {
                emit_mobile_chat_updated(&app_handle, None);
                r#"{"ok":true}"#.to_string()
            },
            Err(error) => serde_json::json!({ "ok": false, "error": error.to_string() }).to_string(),
        };
        return json_response(200, &body);
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
            Err(error) => return json_response(400, &serde_json::json!({ "ok": false, "error": error.to_string() }).to_string()),
        };
        if request.is_temporary.unwrap_or(false) {
            return json_response(200, r#"{"ok":true}"#);
        }
        let result = insert_message(&db, &request).await;
        let body = match result {
            Ok(_) => {
                emit_mobile_chat_updated(&app_handle, Some(&request.conversation_id));
                r#"{"ok":true}"#.to_string()
            },
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
        let provider_type = request.provider_type.unwrap_or(ProviderType::OllamaLocal);
        let provider_result = match request.provider_config_id {
            Some(id) => get_provider_config_by_id(&db, id, provider_type)
                .await
                .and_then(|config| {
                    ProviderFactory::create_chat_provider(config)
                        .ok_or_else(|| "Provider configuration is unavailable.".to_string())
                }),
            None => ProviderSelector::new(db.clone()).get_provider(provider_type, None).await,
        };
        let body = match provider_result {
            Ok(provider) => match provider
                .chat_completion(request.model, request.messages, None, None, None)
                .await
            {
                Ok(mut stream) => {
                    let mut content = String::new();
                    let mut error = None;
                    while let Some(chunk) = stream.next().await {
                        match chunk {
                            Ok(payload) => content.push_str(&payload.content),
                            Err(message) => {
                                error = Some(message);
                                break;
                            }
                        }
                    }
                    match error {
                        Some(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
                        None => {
                            if !request.is_temporary.unwrap_or(false) {
                                if let Some(conversation_id) = request.conversation_id.as_deref() {
                                    let message = BrowserMessageRequest {
                                        id: Uuid::new_v4().to_string(),
                                        conversation_id: conversation_id.to_string(),
                                        role: "assistant".to_string(),
                                        content: content.clone(),
                                        model: None,
                                        provider: Some(provider_type),
                                        is_temporary: Some(false),
                                    };
                                    let _ = insert_message(&db, &message).await;
                                    emit_mobile_chat_updated(&app_handle, Some(conversation_id));
                                }
                            }
                            serde_json::json!({ "ok": true, "message": { "role": "assistant", "content": content, "provider": provider_type } }).to_string()
                        },
                    }
                }
                Err(error) => serde_json::json!({ "ok": false, "error": error }).to_string(),
            },
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
    let rows = sqlx::query("SELECT id, title, createdAt, updatedAt, isArchived, folderId FROM conversations ORDER BY updatedAt DESC")
        .fetch_all(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(serde_json::Value::Array(rows.into_iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>("id"),
            "title": row.get::<String, _>("title"),
            "createdAt": row.get::<String, _>("createdAt"),
            "updatedAt": row.get::<String, _>("updatedAt"),
            "isArchived": row.get::<i64, _>("isArchived") != 0,
            "folderId": row.try_get::<String, _>("folderId").ok(),
        })
    }).collect()))
}

async fn mobile_owner_account_id(db: &sqlx::SqlitePool) -> Result<String, String> {
    if let Ok(row) = sqlx::query("SELECT account_id FROM provider_configs WHERE account_id <> '' ORDER BY updated_at DESC LIMIT 1")
        .fetch_one(db)
        .await
    {
        return Ok(row.get::<String, _>("account_id"));
    }
    if let Ok(row) = sqlx::query("SELECT userId FROM conversations WHERE userId <> '' ORDER BY updatedAt DESC LIMIT 1")
        .fetch_one(db)
        .await
    {
        return Ok(row.get::<String, _>("userId"));
    }
    Ok(String::new())
}

async fn get_all_enabled_provider_configs(db: &sqlx::SqlitePool) -> Result<Vec<crate::providers::base::ProviderConfig>, String> {
    sqlx::query_as::<_, crate::providers::base::ProviderConfig>(
        "SELECT id, account_id, provider_type, enabled, ollama_host, ollama_api_key, ollama_api_base_url, api_key, api_base_url, priority, preset, headers, model_suggestions FROM provider_configs WHERE enabled = 1 ORDER BY account_id ASC, priority ASC"
    )
    .fetch_all(db)
    .await
    .map_err(|error| error.to_string())
}

async fn get_provider_config_by_id(
    db: &sqlx::SqlitePool,
    id: i64,
    provider_type: ProviderType,
) -> Result<crate::providers::base::ProviderConfig, String> {
    sqlx::query_as::<_, crate::providers::base::ProviderConfig>(
        "SELECT id, account_id, provider_type, enabled, ollama_host, ollama_api_key, ollama_api_base_url, api_key, api_base_url, priority, preset, headers, model_suggestions FROM provider_configs WHERE id = ?1 AND provider_type = ?2 AND enabled = 1"
    )
    .bind(id)
    .bind(provider_type)
    .fetch_one(db)
    .await
    .map_err(|error| error.to_string())
}

async fn list_messages(db: &sqlx::SqlitePool, conversation_id: &str) -> Result<serde_json::Value, String> {
    let rows = sqlx::query("SELECT id, conversationId, role, content, createdAt, model, provider, status, errorMessage FROM messages WHERE conversationId = ?1 ORDER BY createdAt ASC")
        .bind(conversation_id)
        .fetch_all(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(serde_json::Value::Array(rows.into_iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>("id"),
            "conversationId": row.get::<String, _>("conversationId"),
            "role": row.get::<String, _>("role"),
            "content": row.get::<String, _>("content"),
            "createdAt": row.get::<String, _>("createdAt"),
            "model": row.try_get::<String, _>("model").ok(),
            "provider": row.try_get::<ProviderType, _>("provider").ok(),
            "status": row.try_get::<String, _>("status").ok(),
            "errorMessage": row.try_get::<String, _>("errorMessage").ok(),
        })
    }).collect()))
}

async fn insert_message(db: &sqlx::SqlitePool, message: &BrowserMessageRequest) -> Result<(), String> {
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
        .bind(message.provider)
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
                return http_response(
                    200,
                    content_type,
                    &String::from_utf8_lossy(&bytes),
                );
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
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist"));
    roots
}

fn public_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        roots.push(current.join("public"));
        roots.push(current.join("..").join("public"));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("public"));
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
    use super::{
        build_pairing_info, is_public_path, response_for_path, AuthRateLimiter, MAX_AUTH_FAILURES,
    };

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
