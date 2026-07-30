use crate::AppState;

#[tauri::command]
pub fn cancel_chat(state: tauri::State<'_, AppState>, request_id: Option<String>) {
    state.chat_requests.cancel(request_id.as_deref());
}
