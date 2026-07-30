use crate::auth::{authorize_account, AuthError};
use crate::memory::service::MemoryService;
use crate::memory::service::{
    MemoryConnectionTestResult, MemoryForgetMessageInput, MemoryRelatedQuery,
    MemoryRememberMessageInput,
};
use crate::memory::types::{
    MemoryCompletedTurnInput, MemoryListQuery, MemoryProcessingRecord, MemoryRecord, MemoryScope,
    MemorySearchQuery, MemorySettings, MemoryUpdateInput,
};
use crate::AppState;

fn service(state: &tauri::State<'_, AppState>) -> MemoryService {
    MemoryService::new(state.db.clone(), state.secret_store.clone())
}

fn map_auth_err(error: AuthError) -> String {
    match error {
        AuthError::SessionExpired => "Session expired".to_string(),
        _ => "Not authorized for this account".to_string(),
    }
}

async fn check_owner(
    state: &tauri::State<'_, AppState>,
    token: Option<&str>,
    owner_id: &str,
) -> Result<(), String> {
    authorize_account(&state.db, token, owner_id)
        .await
        .map_err(map_auth_err)
}

#[tauri::command]
pub async fn memory_get_settings(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    token: Option<String>,
) -> Result<MemorySettings, String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .get_settings(&owner_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_update_settings(
    state: tauri::State<'_, AppState>,
    settings: MemorySettings,
    token: Option<String>,
) -> Result<MemorySettings, String> {
    check_owner(&state, token.as_deref(), &settings.owner_id).await?;
    service(&state)
        .update_settings(settings)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_test_connection(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    token: Option<String>,
) -> Result<MemoryConnectionTestResult, String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .test_connection(&owner_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_list(
    state: tauri::State<'_, AppState>,
    query: MemoryListQuery,
    token: Option<String>,
) -> Result<Vec<MemoryRecord>, String> {
    check_owner(&state, token.as_deref(), &query.owner_id).await?;
    service(&state)
        .list(query)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_search(
    state: tauri::State<'_, AppState>,
    query: MemorySearchQuery,
    token: Option<String>,
) -> Result<Vec<MemoryRecord>, String> {
    check_owner(&state, token.as_deref(), &query.owner_id).await?;
    service(&state)
        .search(query)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_update(
    state: tauri::State<'_, AppState>,
    input: MemoryUpdateInput,
    token: Option<String>,
) -> Result<MemoryRecord, String> {
    check_owner(&state, token.as_deref(), &input.owner_id).await?;
    service(&state)
        .update(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_delete(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    memory_id: String,
    token: Option<String>,
) -> Result<(), String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .delete(&owner_id, &memory_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_clear_scope(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    scope: MemoryScope,
    scope_owner_id: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .clear_scope(&owner_id, scope, scope_owner_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_clear_all(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    token: Option<String>,
) -> Result<(), String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .clear_all(&owner_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_remember_message(
    state: tauri::State<'_, AppState>,
    input: MemoryRememberMessageInput,
    token: Option<String>,
) -> Result<Vec<crate::memory::types::MemoryOperationResult>, String> {
    check_owner(&state, token.as_deref(), &input.owner_id).await?;
    service(&state)
        .remember_message(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_forget_message(
    state: tauri::State<'_, AppState>,
    input: MemoryForgetMessageInput,
    token: Option<String>,
) -> Result<(), String> {
    check_owner(&state, token.as_deref(), &input.owner_id).await?;
    service(&state)
        .forget_message(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_get_related(
    state: tauri::State<'_, AppState>,
    query: MemoryRelatedQuery,
    token: Option<String>,
) -> Result<Vec<MemoryRecord>, String> {
    check_owner(&state, token.as_deref(), &query.owner_id).await?;
    let search = MemorySearchQuery {
        owner_id: query.owner_id,
        query: query.query.or(query.message_id).unwrap_or_default(),
        scope: None,
        scope_owner_id: None,
        category: None,
        include_inactive: false,
        include_deleted: false,
        limit: query.limit,
    };
    service(&state)
        .search(search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_extract_user_message(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    conversation_id: String,
    user_message_id: String,
    chat_model: Option<String>,
    token: Option<String>,
) -> Result<Vec<String>, String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .extract_user_message(
            &owner_id,
            &conversation_id,
            &user_message_id,
            chat_model.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_list_for_chat(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    conversation_id: String,
    token: Option<String>,
) -> Result<Vec<MemoryRecord>, String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .list_for_chat(&owner_id, &conversation_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_debug_extract_last_turn(
    state: tauri::State<'_, AppState>,
    owner_id: String,
    token: Option<String>,
) -> Result<MemoryProcessingRecord, String> {
    check_owner(&state, token.as_deref(), &owner_id).await?;
    service(&state)
        .debug_extract_last_turn(&owner_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_enqueue_completed_turn(
    state: tauri::State<'_, AppState>,
    input: MemoryCompletedTurnInput,
    token: Option<String>,
) -> Result<MemoryProcessingRecord, String> {
    check_owner(&state, token.as_deref(), &input.owner_id).await?;
    service(&state)
        .process_completed_turn(input)
        .await
        .map_err(|error| error.to_string())
}
