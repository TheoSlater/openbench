use crate::acp::capabilities::AgentDescriptor;
use crate::acp::permission::PermissionDecision;
use crate::acp::registry::{EventSink, EVENT_QUEUE_CAPACITY};
use crate::claude::ClaudeSettings;
use crate::codex::CodexSettings;
use crate::runtime::AgentKind;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AcpLaunchRequest {
    pub conversation_id: String,
    pub account_id: String,
    pub agent_kind: AgentKind,
    pub workspace_id: String,
    pub codex_settings: Option<CodexSettings>,
    pub claude_settings: Option<ClaudeSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AcpSessionStart {
    pub session_id: String,
    pub descriptor: AgentDescriptor,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub async fn acp_start_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: AcpLaunchRequest,
    token: Option<String>,
) -> Result<AcpSessionStart, String> {
    crate::commands::connection_commands::authorize_conversation(
        &state,
        &request.conversation_id,
        &request.account_id,
        token.as_deref(),
    )
    .await?;
    let workspace = crate::connections::repository::get_workspace(&state.db, &request.workspace_id)
        .await?
        .ok_or_else(|| "Workspace was not found.".to_string())?;
    if workspace.account_id != request.account_id {
        return Err("Workspace belongs to a different account.".into());
    }
    let options = match request.agent_kind {
        AgentKind::Codex => {
            let settings = request.codex_settings.unwrap_or_default();
            let detection = crate::codex::detect(&settings, now());
            crate::codex::launch_options(&detection, &settings, &workspace.path)
                .map_err(|error| error.to_string())?
        }
        AgentKind::ClaudeCode => {
            let settings = request.claude_settings.unwrap_or_default();
            let detection = crate::claude::detect(&settings, now());
            crate::claude::launch_options(&detection, &workspace.path)
                .map_err(|error| error.to_string())?
        }
    };
    let (sink, mut receiver) = EventSink::new(EVENT_QUEUE_CAPACITY);
    let app_for_events = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            let _ = app_for_events.emit("acp-session-event", event);
        }
    });
    let installation_id = request.agent_kind.as_str();
    let session = state
        .acp
        .start(&request.conversation_id, installation_id, options, sink)
        .await
        .map_err(|error| error.to_string())?;
    let descriptor = session.descriptor.clone();
    let session_id = state
        .acp
        .new_session(&request.conversation_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(AcpSessionStart {
        session_id,
        descriptor,
    })
}

#[tauri::command]
pub async fn acp_prompt(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    prompt: String,
    account_id: String,
    token: Option<String>,
) -> Result<crate::acp::events::TurnEnd, String> {
    crate::commands::connection_commands::authorize_conversation(
        &state,
        &conversation_id,
        &account_id,
        token.as_deref(),
    )
    .await?;
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".into());
    }
    state
        .acp
        .prompt(&conversation_id, &prompt)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn acp_cancel_turn(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    account_id: String,
    token: Option<String>,
) -> Result<(), String> {
    crate::commands::connection_commands::authorize_conversation(
        &state,
        &conversation_id,
        &account_id,
        token.as_deref(),
    )
    .await?;
    state
        .acp
        .cancel_turn(&conversation_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn acp_stop_session(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    account_id: String,
    token: Option<String>,
) -> Result<(), String> {
    crate::commands::connection_commands::authorize_conversation(
        &state,
        &conversation_id,
        &account_id,
        token.as_deref(),
    )
    .await?;
    state.acp.stop(&conversation_id).await;
    Ok(())
}

#[tauri::command]
pub async fn acp_answer_permission(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    request_id: String,
    decision: PermissionDecision,
    account_id: String,
    token: Option<String>,
) -> Result<(), String> {
    crate::commands::connection_commands::authorize_conversation(
        &state,
        &conversation_id,
        &account_id,
        token.as_deref(),
    )
    .await?;
    state
        .acp
        .answer_permission(&request_id, decision)
        .await
        .map_err(|error| error.to_string())
}
