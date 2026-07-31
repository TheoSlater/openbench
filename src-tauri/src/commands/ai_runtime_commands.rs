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
    connection_id: String,
    model_id: String,
    messages: Vec<serde_json::Value>,
    instructions: Option<String>,
    reasoning: Option<String>,
    web_search_provider: Option<String>,
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
    let configured = connection(&state, &request.connection_id, token.as_deref()).await?;
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
        "type": "chat",
        "requestId": request.request_id,
        "responseMessageId": request.response_message_id,
        "conversationId": request.conversation_id,
        "connection": sidecar_connection(&state, &configured, Some(&request.model_id))?,
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
