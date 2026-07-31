//! Tauri surface for the runtime rework data layer.
//!
//! Checkpoint 2 exposes only what a caller actually uses today. The connection,
//! model, installation, and workspace read/write commands land with the UI in
//! checkpoint 7 rather than being stubbed out here.

use crate::connections::ConnectionValidation;
use crate::db::rework_migration;
use crate::runtime::RuntimeRef;
use crate::AppState;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(serde::Deserialize)]
struct DiscoveredModel {
    id: String,
    name: Option<String>,
    owned_by: Option<String>,
}

async fn discover_models(
    state: &AppState,
    connection: &crate::connections::Connection,
    credential: Option<&str>,
) -> Result<Vec<crate::connections::ConnectionModel>, String> {
    let value =
        crate::commands::ai_runtime_commands::discover_models(state, connection, credential)
            .await?;
    let rows: Vec<DiscoveredModel> = serde_json::from_value(value)
        .map_err(|_| "Model discovery returned an invalid catalog".to_string())?;
    let seen = now();
    Ok(rows
        .into_iter()
        .map(|model| crate::connections::ConnectionModel {
            connection_id: connection.id.clone(),
            remote_id: model.id.clone(),
            display_name: model.name.or(Some(model.id)),
            capabilities: None,
            enabled: true,
            aliases: Vec::new(),
            metadata: model
                .owned_by
                .map(|owner| serde_json::json!({ "ownedBy": owner }).to_string()),
            discovery_source: crate::connections::DiscoverySource::Remote,
            last_seen_at: Some(seen.clone()),
        })
        .collect())
}

async fn validate(
    state: &AppState,
    connection: &crate::connections::Connection,
    credential: Option<&str>,
) -> Result<ConnectionValidation, String> {
    let models = discover_models(state, connection, credential).await?;
    Ok(validation_for(&models))
}

fn validation_for(models: &[crate::connections::ConnectionModel]) -> ConnectionValidation {
    ConnectionValidation {
        ready: true,
        message: format!("Connected. {} model(s) available.", models.len()),
    }
}

/// Resolve a legacy `localStorage["default_model"]` value against the migrated
/// schema.
///
/// Returns `None` when the stored value names a provider or endpoint that no
/// longer exists, which tells the frontend to clear the key instead of retrying
/// it on every launch — the pre-rework behavior, where an unresolvable default
/// was silently ignored forever.
#[tauri::command]
pub async fn resolve_legacy_default_model(
    state: tauri::State<'_, AppState>,
    account_id: Option<String>,
    stored: String,
) -> Result<Option<RuntimeRef>, String> {
    rework_migration::resolve_legacy_model_choice(
        &state.db,
        account_id.as_deref().unwrap_or_default(),
        &stored,
    )
    .await
}

async fn authorized_connection(
    state: &tauri::State<'_, AppState>,
    connection_id: &str,
    token: Option<&str>,
) -> Result<crate::connections::Connection, String> {
    let connection = crate::connections::repository::get_connection(&state.db, connection_id)
        .await?
        .ok_or_else(|| format!("Connection {connection_id} was not found."))?;
    crate::auth::authorize_account(&state.db, token, &connection.account_id)
        .await
        .map_err(|_| "Not authorized for this connection.".to_string())?;
    Ok(connection)
}

#[tauri::command]
pub async fn validate_connection(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    token: Option<String>,
) -> Result<ConnectionValidation, String> {
    let connection = authorized_connection(&state, &connection_id, token.as_deref()).await?;
    let result = validate(&state, &connection, None).await;
    let (status, detail) = match &result {
        Ok(validation) => (
            crate::connections::ConnectionHealthStatus::Ready,
            validation.message.as_str(),
        ),
        Err(error) => (
            crate::connections::ConnectionHealthStatus::Failed,
            error.as_str(),
        ),
    };
    crate::connections::repository::record_connection_health(
        &state.db,
        &connection_id,
        status,
        detail,
        &now(),
    )
    .await?;
    result
}

#[tauri::command]
pub async fn refresh_connection_models(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    token: Option<String>,
) -> Result<Vec<crate::connections::ConnectionModel>, String> {
    let connection = authorized_connection(&state, &connection_id, token.as_deref()).await?;
    let models = discover_models(&state, &connection, None).await?;
    crate::connections::repository::refresh_discovered_models(&state.db, &connection_id, &models)
        .await?;
    crate::connections::repository::list_models(&state.db, &connection_id).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_manual_connection_model(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    remote_id: String,
    display_name: Option<String>,
    capabilities: Option<String>,
    enabled: bool,
    aliases: Vec<String>,
    metadata: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    authorized_connection(&state, &connection_id, token.as_deref()).await?;
    if remote_id.trim().is_empty() {
        return Err("Model id cannot be empty.".into());
    }
    for (label, value) in [("capabilities", &capabilities), ("metadata", &metadata)] {
        if value
            .as_deref()
            .is_some_and(|value| serde_json::from_str::<serde_json::Value>(value).is_err())
        {
            return Err(format!("Model {label} must be valid JSON."));
        }
    }
    crate::connections::repository::upsert_model(
        &state.db,
        &crate::connections::ConnectionModel {
            connection_id,
            remote_id,
            display_name,
            capabilities,
            enabled,
            aliases,
            metadata,
            discovery_source: crate::connections::DiscoverySource::Manual,
            last_seen_at: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn save_chat_connection(
    state: tauri::State<'_, AppState>,
    mut connection: crate::connections::Connection,
    credential: Option<String>,
    token: Option<String>,
) -> Result<ConnectionValidation, String> {
    if connection.id.trim().is_empty() || connection.display_name.trim().is_empty() {
        return Err("Connection id and name are required.".into());
    }
    crate::auth::authorize_account(&state.db, token.as_deref(), &connection.account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    if let Some(existing) =
        crate::connections::repository::get_connection(&state.db, &connection.id).await?
    {
        if existing.account_id != connection.account_id || existing.provider != connection.provider
        {
            return Err(
                "A connection's account and provider cannot change; create a new connection."
                    .into(),
            );
        }
    }
    reject_secret_headers(connection.extra_headers.as_deref())?;
    if connection.provider.needs_credential()
        && credential
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
    {
        return Err("API key cannot be empty.".into());
    }

    let reference = crate::connections::secrets::SecretRef::for_connection(&connection.id);
    connection.secret_ref = if connection.provider.needs_credential() || credential.is_some() {
        Some(reference.clone())
    } else {
        None
    };

    let mut validation_connection = connection.clone();
    validation_connection.enabled = true;
    let models = discover_models(&state, &validation_connection, credential.as_deref()).await?;
    let validation = validation_for(&models);

    if let Some(value) = credential {
        state
            .secret_store
            .set(&reference, &crate::connections::secrets::Secret::new(value))
            .map_err(|error| error.to_string())?;
    }
    crate::connections::repository::save_connection(&state.db, &connection).await?;
    crate::connections::repository::refresh_discovered_models(&state.db, &connection.id, &models)
        .await?;
    crate::connections::repository::record_connection_health(
        &state.db,
        &connection.id,
        crate::connections::ConnectionHealthStatus::Ready,
        &validation.message,
        &now(),
    )
    .await?;
    Ok(validation)
}

#[tauri::command]
pub async fn list_chat_connections(
    state: tauri::State<'_, AppState>,
    account_id: String,
    token: Option<String>,
) -> Result<Vec<crate::connections::Connection>, String> {
    crate::auth::authorize_account(&state.db, token.as_deref(), &account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    crate::connections::repository::list_connections(&state.db, &account_id)
        .await
        .map(|connections| {
            connections
                .into_iter()
                .map(|connection| connection.redacted())
                .collect()
        })
}

#[tauri::command]
pub async fn list_connection_summaries(
    state: tauri::State<'_, AppState>,
    account_id: String,
    token: Option<String>,
) -> Result<Vec<crate::connections::ConnectionSummary>, String> {
    crate::auth::authorize_account(&state.db, token.as_deref(), &account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    let mut summaries =
        crate::connections::repository::list_connection_summaries(&state.db, &account_id).await?;
    for summary in &mut summaries {
        summary.connection = summary.connection.redacted();
    }
    Ok(summaries)
}

#[tauri::command]
pub async fn delete_chat_connection(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    token: Option<String>,
) -> Result<(), String> {
    let connection = authorized_connection(&state, &connection_id, token.as_deref()).await?;
    if let Some(reference) = connection.secret_ref.as_ref() {
        state
            .secret_store
            .delete(reference)
            .map_err(|error| error.to_string())?;
    }
    crate::connections::repository::delete_connection(&state.db, &connection_id).await
}

#[tauri::command]
pub async fn list_workspaces(
    state: tauri::State<'_, AppState>,
    account_id: String,
    token: Option<String>,
) -> Result<Vec<crate::connections::Workspace>, String> {
    crate::auth::authorize_account(&state.db, token.as_deref(), &account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    crate::connections::repository::list_workspaces(&state.db, &account_id).await
}

#[tauri::command]
pub async fn save_workspace(
    state: tauri::State<'_, AppState>,
    mut workspace: crate::connections::Workspace,
    token: Option<String>,
) -> Result<crate::connections::Workspace, String> {
    crate::auth::authorize_account(&state.db, token.as_deref(), &workspace.account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    let path = std::path::Path::new(workspace.path.trim());
    if !path.is_dir() {
        return Err(format!(
            "Workspace directory does not exist: {}",
            path.display()
        ));
    }
    workspace.path = path.display().to_string();
    workspace.availability = crate::connections::WorkspaceAvailability::Available;
    workspace.last_validated_at = Some(now());
    crate::connections::repository::upsert_workspace(&state.db, &workspace).await?;
    Ok(workspace)
}

#[tauri::command]
pub async fn get_conversation_runtime(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    account_id: String,
    token: Option<String>,
) -> Result<Option<RuntimeRef>, String> {
    authorize_conversation(&state, &conversation_id, &account_id, token.as_deref()).await?;
    crate::connections::repository::get_conversation_runtime(&state.db, &conversation_id).await
}

#[tauri::command]
pub async fn set_conversation_runtime(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    runtime: RuntimeRef,
    account_id: String,
    token: Option<String>,
) -> Result<(), String> {
    authorize_conversation(&state, &conversation_id, &account_id, token.as_deref()).await?;
    match &runtime {
        RuntimeRef::ChatModel { connection_id, .. } => {
            let connection = authorized_connection(&state, connection_id, token.as_deref()).await?;
            if connection.account_id != account_id {
                return Err("Runtime connection belongs to a different account.".into());
            }
        }
        RuntimeRef::CodingAgent { workspace_id, .. } => {
            let workspace = crate::connections::repository::get_workspace(&state.db, workspace_id)
                .await?
                .ok_or_else(|| "Workspace was not found.".to_string())?;
            if workspace.account_id != account_id {
                return Err("Runtime workspace belongs to a different account.".into());
            }
        }
        RuntimeRef::Unresolved { .. } => {}
    }
    crate::connections::repository::set_conversation_runtime(&state.db, &conversation_id, &runtime)
        .await
}

#[tauri::command]
pub async fn list_recent_runtimes(
    state: tauri::State<'_, AppState>,
    account_id: String,
    token: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<RuntimeRef>, String> {
    crate::auth::authorize_account(&state.db, token.as_deref(), &account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    crate::connections::repository::list_recent_runtimes(
        &state.db,
        &account_id,
        limit.unwrap_or(8).min(32),
    )
    .await
}

pub(crate) async fn authorize_conversation(
    state: &tauri::State<'_, AppState>,
    conversation_id: &str,
    account_id: &str,
    token: Option<&str>,
) -> Result<(), String> {
    crate::auth::authorize_account(&state.db, token, account_id)
        .await
        .map_err(|_| "Not authorized for this account.".to_string())?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT userId FROM conversations WHERE id = ?1")
            .bind(conversation_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|error| error.to_string())?;
    match owner {
        Some(owner) if owner == account_id => Ok(()),
        Some(_) => Err("Conversation belongs to a different account.".into()),
        None => Err("Conversation was not found.".into()),
    }
}

#[tauri::command]
pub async fn list_connection_models(
    state: tauri::State<'_, AppState>,
    connection_id: String,
    token: Option<String>,
) -> Result<Vec<crate::connections::ConnectionModel>, String> {
    authorized_connection(&state, &connection_id, token.as_deref()).await?;
    crate::connections::repository::list_models(&state.db, &connection_id).await
}

fn reject_secret_headers(raw: Option<&str>) -> Result<(), String> {
    let Some(raw) = raw else { return Ok(()) };
    let headers: serde_json::Map<String, serde_json::Value> = serde_json::from_str(raw)
        .map_err(|_| "Extra headers must be a JSON object.".to_string())?;
    if headers.keys().any(|name| {
        let name = name.to_ascii_lowercase();
        name.contains("authorization")
            || name.contains("api-key")
            || name.contains("apikey")
            || name.contains("token")
    }) {
        return Err(
            "Credential headers cannot be stored in connection metadata; use the API key field."
                .into(),
        );
    }
    if headers.values().any(|value| !value.is_string()) {
        return Err("Every extra header value must be a string.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::reject_secret_headers;

    #[test]
    fn connection_boundary_rejects_secret_headers() {
        assert!(reject_secret_headers(Some(r#"{"Authorization":"Bearer secret"}"#)).is_err());
        assert!(reject_secret_headers(Some(r#"{"x-api-key":"secret"}"#)).is_err());
        assert!(reject_secret_headers(Some(r#"{"X-Organization":"org"}"#)).is_ok());
    }
}
