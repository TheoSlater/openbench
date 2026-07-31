use crate::connections::repository;
use crate::connections::secrets::{SecretError, SecretRef};
use crate::AppState;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiChatRequest {
    request_id: String,
    response_message_id: Option<String>,
    conversation_id: String,
    connection_id: Option<String>,
    model_id: Option<String>,
    agent: Option<AiAgentRequest>,
    messages: Vec<serde_json::Value>,
    instructions: Option<String>,
    reasoning: Option<String>,
    web_search_provider: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AiAgentRequest {
    kind: String,
    workspace_id: String,
    access_mode: String,
    session_id: Option<String>,
}

async fn connection(
    state: &tauri::State<'_, AppState>,
    connection_id: &str,
    token: Option<&str>,
) -> Result<crate::connections::Connection, String> {
    let connection = repository::get_connection(&state.db, connection_id)
        .await?
        .ok_or_else(|| "Connection was not found".to_string())?;
    crate::auth::authorize_account(&state.db, token, &connection.account_id)
        .await
        .map_err(|_| "Not authorized for this connection".to_string())?;
    Ok(connection)
}

fn secret(
    state: &tauri::State<'_, AppState>,
    reference: Option<&SecretRef>,
) -> Result<Option<String>, String> {
    let Some(reference) = reference else {
        return Ok(None);
    };
    state
        .secret_store
        .get(reference)
        .map(|value| Some(value.expose().to_string()))
        .or_else(|error| match error {
            SecretError::NotFound => Ok(None),
            SecretError::Unavailable(detail) => Err(format!("Credential store unavailable: {detail}")),
        })
}

fn headers(raw: Option<&str>) -> Result<Option<BTreeMap<String, String>>, String> {
    raw.map(|value| {
        serde_json::from_str(value).map_err(|_| "Connection headers are invalid".to_string())
    })
    .transpose()
}

fn sidecar_connection(
    state: &tauri::State<'_, AppState>,
    connection: &crate::connections::Connection,
    model_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "id": connection.id,
        "provider": connection.provider.as_str(),
        "modelId": model_id,
        "baseUrl": connection.effective_base_url(),
        "headers": headers(connection.extra_headers.as_deref())?,
        "secret": secret(state, connection.secret_ref.as_ref())?,
    }))
}

#[tauri::command]
pub async fn ai_runtime_start(
    state: tauri::State<'_, AppState>,
    request: AiChatRequest,
    token: Option<String>,
) -> Result<(), String> {
    let runtime = if let Some(agent) = request.agent {
        let workspace = repository::get_workspace(&state.db, &agent.workspace_id)
            .await?
            .ok_or_else(|| "Workspace was not found".to_string())?;
        crate::auth::authorize_account(&state.db, token.as_deref(), &workspace.account_id)
            .await
            .map_err(|_| "Not authorized for this workspace".to_string())?;
        if !std::path::Path::new(&workspace.path).is_dir() {
            return Err("Workspace directory is unavailable".into());
        }
        if !matches!(agent.kind.as_str(), "claude-code" | "codex") {
            return Err("Unknown coding agent".into());
        }
        if !matches!(agent.access_mode.as_str(), "read-only" | "workspace-write") {
            return Err("Unknown workspace access mode".into());
        }
        serde_json::json!({
            "type": "agent",
            "agent": {
                "kind": agent.kind,
                "workspace": workspace.path,
                "accessMode": agent.access_mode,
                "sessionId": agent.session_id,
            }
        })
    } else {
        let connection_id = request.connection_id.as_deref()
            .ok_or_else(|| "Connection id is required".to_string())?;
        let model_id = request.model_id.as_deref()
            .ok_or_else(|| "Model id is required".to_string())?;
        let configured = connection(&state, connection_id, token.as_deref()).await?;
        serde_json::json!({
            "type": "chat",
            "connection": sidecar_connection(&state, &configured, Some(model_id))?,
        })
    };
    let web_search = if let Some(provider) = request.web_search_provider.as_deref() {
        let secret_ref = SecretRef::for_web_search(provider);
        Some(serde_json::json!({
            "provider": provider,
            "secret": secret(&state, Some(&secret_ref))?,
        }))
    } else {
        None
    };
    let command = serde_json::json!({
        "type": runtime["type"],
        "requestId": request.request_id,
        "responseMessageId": request.response_message_id,
        "conversationId": request.conversation_id,
        "connection": runtime.get("connection"),
        "agent": runtime.get("agent"),
        "messages": request.messages,
        "instructions": request.instructions,
        "reasoning": request.reasoning,
        "webSearch": web_search,
    });
    state
        .ai
        .start_stream(
            command["requestId"].as_str().expect("request id"),
            command.clone(),
        )
        .await
}

#[tauri::command]
pub async fn ai_runtime_cancel(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    state.ai.cancel(&request_id).await
}

#[tauri::command]
pub async fn ai_runtime_approval(
    state: tauri::State<'_, AppState>,
    request_id: String,
    approval_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<(), String> {
    state.ai.approval(&request_id, &approval_id, approved, reason).await
}

#[tauri::command]
pub async fn ai_runtime_models(
    state: tauri::State<'_, AppState>,
    request_id: String,
    connection_id: String,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    let configured = connection(&state, &connection_id, token.as_deref()).await?;
    state
        .ai
        .request(
            &request_id,
            serde_json::json!({
                "type": "list-models",
                "requestId": request_id,
                "connection": sidecar_connection(&state, &configured, None)?,
            }),
        )
        .await
}

#[tauri::command]
pub async fn ai_runtime_generate(
    state: tauri::State<'_, AppState>,
    request_id: String,
    connection_id: String,
    model_id: String,
    prompt: String,
    instructions: Option<String>,
    token: Option<String>,
) -> Result<serde_json::Value, String> {
    let configured = connection(&state, &connection_id, token.as_deref()).await?;
    state
        .ai
        .request(
            &request_id,
            serde_json::json!({
                "type": "generate",
                "requestId": request_id,
                "connection": sidecar_connection(&state, &configured, Some(&model_id))?,
                "prompt": prompt,
                "instructions": instructions,
            }),
        )
        .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn frontend_chat_shape_has_no_secret_field() {
        let source = include_str!("ai_runtime_commands.rs");
        let shape = source
            .split("pub struct AiChatRequest")
            .nth(1)
            .and_then(|tail| tail.split('}').next())
            .unwrap();
        for forbidden in ["secret", "credential", "api_key", "authorization"] {
            assert!(!shape.to_lowercase().contains(forbidden), "{forbidden}");
        }
    }
}
