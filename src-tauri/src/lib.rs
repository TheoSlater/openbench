use ollama_rs::generation::chat::request::ChatMessageRequest;
use ollama_rs::generation::chat::ChatMessage;
use ollama_rs::Ollama;
use tauri::{AppHandle, Emitter};
use tokio_stream::StreamExt;

struct AppState {
    ollama: Ollama,
}

#[tauri::command]
async fn get_local_models(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let models = state
        .ollama
        .list_local_models()
        .await
        .map_err(|e| e.to_string())?;
    Ok(models.into_iter().map(|m| m.name).collect())
}

#[derive(serde::Serialize, Clone)]
struct StreamPayload {
    content: String,
    done: bool,
}

#[tauri::command]
async fn chat_stream(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    model: String,
    message: String,
    system_prompt: Option<String>,
) -> Result<(), String> {
    if let Some(ref prompt) = system_prompt {
        println!(
            "[openbench] system_prompt length={} preview={}",
            prompt.len(),
            prompt.chars().take(80).collect::<String>()
        );
    } else {
        println!("[openbench] system_prompt missing");
    }

    let mut messages = Vec::new();
    if let Some(prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            messages.push(ChatMessage::system(prompt));
        }
    }
    messages.push(ChatMessage::user(message));
    let request = ChatMessageRequest::new(model, messages);

    let mut stream = state
        .ollama
        .send_chat_messages_stream(request)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(res) = stream.next().await {
        match res {
            Ok(response) => {
                let _ = app_handle.emit(
                    "chat-chunk",
                    StreamPayload {
                        content: response.message.content,
                        done: response.done,
                    },
                );
            }
            Err(_) => {
                return Err("Stream encountered an error".to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn chat(
    state: tauri::State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let request = ChatMessageRequest::new(model, messages);
    let response = state
        .ollama
        .send_chat_messages(request)
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.message.content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            ollama: Ollama::default(),
        })
        .invoke_handler(tauri::generate_handler![
            get_local_models,
            chat_stream,
            chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
