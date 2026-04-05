mod auth;
mod db;

use ollama_rs::generation::chat::request::ChatMessageRequest;
use ollama_rs::generation::chat::ChatMessage as OllamaChatMessage;
use ollama_rs::generation::images::Image;
use ollama_rs::Ollama;
use tauri::{AppHandle, Emitter};
use tokio_stream::StreamExt;

use std::sync::atomic::{AtomicUsize, Ordering};

struct AppState {
    current_generation_id: AtomicUsize,
}

#[derive(serde::Serialize, Clone)]
struct StreamMetadata {
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
    total_duration: Option<u64>,
    load_duration: Option<u64>,
    prompt_eval_duration: Option<u64>,
    eval_duration: Option<u64>,
}

#[derive(serde::Serialize, Clone)]
struct StreamPayload {
    content: String,
    done: bool,
    metadata: Option<StreamMetadata>,
}

#[derive(serde::Serialize, Clone)]
struct PullProgressPayload {
    status: String,
    digest: Option<String>,
    total: Option<u64>,
    completed: Option<u64>,
}

#[derive(serde::Serialize, Clone)]
pub struct ModelDetails {
    pub name: String,
    pub families: Vec<String>,
    pub supports_vision: bool,
}

#[tauri::command]
async fn get_local_models() -> Result<Vec<ModelDetails>, String> {
    let ollama = Ollama::default();
    let models = ollama
        .list_local_models()
        .await
        .map_err(|e| e.to_string())?;

    let mut details = Vec::new();
    for model in models {
        let name_lower = model.name.to_lowercase();
        let supports_vision = name_lower.contains("llava")
            || name_lower.contains("moondream")
            || name_lower.contains("vision")
            || name_lower.contains("bakllava")
            || name_lower.contains("llama3.2")
            || name_lower.contains("minicpm-v")
            || name_lower.contains("pixtral")
            || name_lower.contains("molmo")
            || name_lower.contains("internvl");

        details.push(ModelDetails {
            name: model.name,
            families: Vec::new(), // families not available on LocalModel in this version
            supports_vision,
        });
    }

    Ok(details)
}

#[tauri::command]
async fn pull_model(
    app_handle: AppHandle,
    model: String,
) -> Result<(), String> {
    let ollama = Ollama::default();
    let mut stream = ollama
        .pull_model_stream(model, false)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(res) = stream.next().await {
        match res {
            Ok(response) => {
                let _ = app_handle.emit(
                    "pull-progress",
                    PullProgressPayload {
                        status: response.message,
                        digest: response.digest,
                        total: response.total,
                        completed: response.completed,
                    },
                );
            }
            Err(e) => {
                return Err(e.to_string());
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn cancel_chat(state: tauri::State<'_, AppState>) {
    state.current_generation_id.fetch_add(1, Ordering::SeqCst);
}

#[derive(serde::Deserialize)]
struct ChatAttachment {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    #[serde(rename = "type")]
    content_type: String,
    #[allow(dead_code)]
    size: u64,
    content: Option<String>, // base64 for images
}

#[derive(serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    attachments: Option<Vec<ChatAttachment>>,
}

#[tauri::command]
async fn chat_stream(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    model: String,
    messages: Vec<ChatMessage>,
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

    let mut all_messages = Vec::new();
    if let Some(prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            all_messages.push(OllamaChatMessage::system(prompt));
        }
    }

    for msg in messages {
        let mut ollama_msg = match msg.role.as_str() {
            "user" => OllamaChatMessage::user(msg.content),
            "assistant" => OllamaChatMessage::assistant(msg.content),
            _ => OllamaChatMessage::user(msg.content),
        };

        if let Some(attachments) = msg.attachments {
            let mut images = Vec::new();

            for att in attachments {
                if att.content_type.starts_with("image/") {
                    if let Some(content) = att.content {
                        // content is base64
                        images.push(Image::from_base64(&content));
                    }
                }
            }

            if !images.is_empty() {
                ollama_msg.images = Some(images);
            }
        }
        all_messages.push(ollama_msg);
    }

    let request = ChatMessageRequest::new(model, all_messages);

    let current_gen_id = state.current_generation_id.fetch_add(1, Ordering::SeqCst) + 1;

    let ollama = Ollama::default();
    let mut stream = ollama
        .send_chat_messages_stream(request)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(res) = stream.next().await {
        if state.current_generation_id.load(Ordering::SeqCst) != current_gen_id {
            // Cancelled or a new generation started. Do NOT emit done: true,
            // as it could prematurely terminate a new stream on the frontend.
            break;
        }

        match res {
            Ok(response) => {
                let is_done = response.done;
                let metadata = if let Some(final_data) = response.final_data {
                    Some(StreamMetadata {
                        prompt_eval_count: Some(final_data.prompt_eval_count),
                        eval_count: Some(final_data.eval_count),
                        total_duration: Some(final_data.total_duration),
                        load_duration: Some(final_data.load_duration),
                        prompt_eval_duration: Some(final_data.prompt_eval_duration),
                        eval_duration: Some(final_data.eval_duration),
                    })
                } else {
                    None
                };

                let _ = app_handle.emit(
                    "chat-chunk",
                    StreamPayload {
                        content: response.message.content,
                        done: is_done,
                        metadata,
                    },
                );
            }
            Err(_) => {
                return Err("Stream encountered an error".to_string());
            }
        }
    }

    // Ensure we emit a done payload if we reached the end of the stream
    // but haven't sent a done: true yet.
    if state.current_generation_id.load(Ordering::SeqCst) == current_gen_id {
        let _ = app_handle.emit(
            "chat-chunk",
            StreamPayload {
                content: "".to_string(),
                done: true,
                metadata: None,
            },
        );
    }

    Ok(())
}

#[tauri::command]
async fn chat(
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let mut all_messages = Vec::new();
    for msg in messages {
        let mut ollama_msg = match msg.role.as_str() {
            "user" => OllamaChatMessage::user(msg.content),
            "assistant" => OllamaChatMessage::assistant(msg.content),
            _ => OllamaChatMessage::user(msg.content),
        };

        if let Some(attachments) = msg.attachments {
            let mut images = Vec::new();
            let model_lower = model.to_lowercase();
            let is_vision_model = model_lower.contains("llava") 
                || model_lower.contains("moondream")
                || model_lower.contains("vision")
                || model_lower.contains("bakllava");

            if is_vision_model {
                for att in attachments {
                    if let Some(content) = att.content {
                        images.push(Image::from_base64(&content));
                    }
                }
            }
            if !images.is_empty() {
                ollama_msg.images = Some(images);
            }
        }
        all_messages.push(ollama_msg);
    }

    let request = ChatMessageRequest::new(model, all_messages);
    let ollama = Ollama::default();
    let response = ollama
        .send_chat_messages(request)
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.message.content)
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            current_generation_id: AtomicUsize::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            get_local_models,
            pull_model,
            chat_stream,
            chat,
            cancel_chat,
            auth::auth_signup,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_get_current_user,
            auth::auth_update_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
