use crate::auth::{authorize_account, AuthError};
use crate::memory::service::MemoryService;
use crate::models::chat::ChatMessage;
use crate::providers::adapter::{
    AdapterChatRequest, ChatEventSink, ChatRuntimeEvent, ConnectionProviderAdapter, ProviderAdapter,
};
use crate::title_generator;
use crate::web_search::WebSearchConfig;
use crate::AppState;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

fn map_auth_err(error: AuthError) -> String {
    match error {
        AuthError::SessionExpired => "Session expired".to_string(),
        _ => "Not authorized for this account".to_string(),
    }
}

async fn check_account(
    state: &tauri::State<'_, AppState>,
    token: Option<&str>,
    account_id: Option<&str>,
) -> Result<(), String> {
    match account_id {
        Some(id) => authorize_account(&state.db, token, id)
            .await
            .map_err(map_auth_err),
        None => Ok(()),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_stream(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    request_id: String,
    conversation_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    web_search_config: Option<WebSearchConfig>,
    reasoning_enabled: bool,
    connection_id: Option<String>,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let (connection, runtime_model) = resolve_chat_connection(
        &state,
        &conversation_id,
        connection_id.as_deref(),
        &model,
        account_id.as_deref(),
    )
    .await?;
    let adapter = ConnectionProviderAdapter::new(connection, state.secret_store.as_ref())
        .map_err(|error| format_runtime_error(&error))?;

    let memory_context = match account_id.as_deref() {
        Some(owner_id) if !owner_id.trim().is_empty() => {
            let recall_query = messages
                .iter()
                .rev()
                .find(|message| message.role == "user")
                .map(|message| message.content.as_str())
                .unwrap_or_default();
            match MemoryService::new(state.db.clone(), state.secret_store.clone())
                .build_context_for_chat(owner_id, &conversation_id, recall_query)
                .await
            {
                Ok(context) => context,
                Err(error) => {
                    log::warn!("Memory recall skipped: {error}");
                    String::new()
                }
            }
        }
        _ => String::new(),
    };
    let system_prompt = append_memory_context(system_prompt, memory_context);

    let cancellation = state.chat_requests.register(&request_id)?;
    let (events, receiver) = ChatEventSink::channel();
    let drain = tauri::async_runtime::spawn(drain_chat_events(app_handle, receiver));
    let result = adapter
        .stream_chat(
            AdapterChatRequest {
                request_id: request_id.clone(),
                model: runtime_model,
                messages,
                system_prompt,
                reasoning_enabled,
                web_search: web_search_config,
            },
            cancellation,
            events,
        )
        .await;
    state.chat_requests.finish(&request_id);
    let _ = drain.await;

    match result {
        Ok(_) => Ok(()),
        Err(error) if error.code == "cancelled" => Ok(()),
        Err(error) => Err(format_runtime_error(&error)),
    }
}

fn append_memory_context(system_prompt: Option<String>, memory_context: String) -> Option<String> {
    if memory_context.trim().is_empty() {
        return system_prompt;
    }
    Some(match system_prompt {
        Some(prompt) if !prompt.trim().is_empty() => format!("{prompt}\n\n{memory_context}"),
        _ => memory_context,
    })
}

#[cfg(test)]
mod tests {
    use super::append_memory_context;

    #[test]
    fn memory_context_appends_without_replacing_prompt() {
        let prompt = append_memory_context(
            Some("System".to_string()),
            "<poly_memory>x</poly_memory>".to_string(),
        );
        assert_eq!(prompt.unwrap(), "System\n\n<poly_memory>x</poly_memory>");
    }

    #[test]
    fn empty_memory_context_preserves_prompt() {
        assert_eq!(
            append_memory_context(Some("System".to_string()), String::new()).unwrap(),
            "System"
        );
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat(
    state: tauri::State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
    options: Option<Value>,
    connection_id: Option<String>,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<String, String> {
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let connection = resolve_model_connection(
        &state,
        connection_id.as_deref(),
        &model,
        account_id.as_deref(),
    )
    .await?;
    let adapter = ConnectionProviderAdapter::new(connection, state.secret_store.as_ref())
        .map_err(|error| format_runtime_error(&error))?;
    let mut stream = adapter
        .chat_provider()
        .chat_completion(model, messages, None, options, None)
        .await?;

    let mut full_content = String::new();
    while let Some(result) = tokio_stream::StreamExt::next(&mut stream).await {
        let chunk = result.map_err(|e| e.to_string())?;
        full_content.push_str(&chunk.content);
        if chunk.done {
            break;
        }
    }

    Ok(title_generator::strip_thinking_blocks(&full_content))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn generate_chat_title(
    state: tauri::State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
    user_name: Option<String>,
    connection_id: Option<String>,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<Option<String>, String> {
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let connection = match resolve_model_connection(
        &state,
        connection_id.as_deref(),
        &model,
        account_id.as_deref(),
    )
    .await
    {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("[TitleGeneration] Provider unavailable: {error}");
            return Ok(None);
        }
    };
    let adapter = match ConnectionProviderAdapter::new(connection, state.secret_store.as_ref()) {
        Ok(adapter) => adapter,
        Err(error) => {
            eprintln!(
                "[TitleGeneration] Provider unavailable: {}",
                format_runtime_error(&error)
            );
            return Ok(None);
        }
    };

    Ok(title_generator::generate_title(
        adapter.chat_provider(),
        &model,
        &messages,
        user_name.as_deref(),
    )
    .await)
}

async fn resolve_chat_connection(
    state: &tauri::State<'_, AppState>,
    conversation_id: &str,
    explicit_connection_id: Option<&str>,
    requested_model: &str,
    account_id: Option<&str>,
) -> Result<(crate::connections::Connection, String), String> {
    if let Some(connection_id) = explicit_connection_id {
        let connection = checked_connection(state, connection_id, account_id).await?;
        return Ok((connection, requested_model.to_string()));
    }

    match crate::connections::repository::get_conversation_runtime(&state.db, conversation_id)
        .await?
    {
        Some(crate::runtime::RuntimeRef::ChatModel {
            connection_id,
            model_id,
        }) => Ok((
            checked_connection(state, &connection_id, account_id).await?,
            model_id,
        )),
        Some(crate::runtime::RuntimeRef::CodingAgent { .. }) => {
            Err("This conversation uses a coding agent, not a chat model.".into())
        }
        Some(crate::runtime::RuntimeRef::Unresolved { .. }) => {
            Err("Choose a chat connection and model for this conversation.".into())
        }
        None => Ok((
            resolve_model_connection(state, None, requested_model, account_id).await?,
            requested_model.to_string(),
        )),
    }
}

async fn resolve_model_connection(
    state: &tauri::State<'_, AppState>,
    explicit_connection_id: Option<&str>,
    model: &str,
    account_id: Option<&str>,
) -> Result<crate::connections::Connection, String> {
    if let Some(connection_id) = explicit_connection_id {
        return checked_connection(state, connection_id, account_id).await;
    }

    // Upgrade fallback for conversations created before RuntimeRef existed.
    let connections =
        crate::connections::repository::list_connections(&state.db, account_id.unwrap_or_default())
            .await?;
    let mut matches = Vec::new();
    for connection in connections
        .into_iter()
        .filter(|connection| connection.enabled)
    {
        if crate::connections::repository::model_exists(&state.db, &connection.id, model).await? {
            matches.push(connection);
        }
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!(
            "No enabled connection offers model {model}. Refresh models or choose a connection."
        )),
        _ => Err(format!(
            "More than one connection offers model {model}. Choose a connection."
        )),
    }
}

async fn checked_connection(
    state: &tauri::State<'_, AppState>,
    connection_id: &str,
    account_id: Option<&str>,
) -> Result<crate::connections::Connection, String> {
    let connection = crate::connections::repository::get_connection(&state.db, connection_id)
        .await?
        .ok_or_else(|| format!("Connection {connection_id} was not found."))?;
    if account_id.is_some_and(|account_id| account_id != connection.account_id) {
        return Err("Not authorized for this connection.".into());
    }
    Ok(connection)
}

fn format_runtime_error(error: &crate::providers::adapter::ChatRuntimeError) -> String {
    match &error.action {
        Some(action) => format!("{} {action}", error.message),
        None => error.message.clone(),
    }
}

async fn drain_chat_events(
    app_handle: AppHandle,
    mut receiver: tokio::sync::mpsc::Receiver<ChatRuntimeEvent>,
) {
    while let Some(event) = receiver.recv().await {
        let _ = app_handle.emit("chat-runtime-event", &event);
    }
}
