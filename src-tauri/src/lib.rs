mod auth;
mod db;

use chrono::{DateTime, Datelike, Duration, Utc};
use ollama_rs::generation::chat::request::ChatMessageRequest;
use ollama_rs::generation::chat::ChatMessage as OllamaChatMessage;
use ollama_rs::generation::images::Image;
use ollama_rs::generation::tools::ToolCall;
use ollama_rs::Ollama;
use tauri::{AppHandle, Emitter};
use tokio_stream::StreamExt;

use std::sync::atomic::{AtomicUsize, Ordering};

const VISION_MODEL_KEYWORDS: &[&str] = &[
    "llava",
    "moondream",
    "vision",
    "bakllava",
    "llama3.2",
    "minicpm-v",
    "pixtral",
    "molmo",
    "internvl",
];

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
    request_id: String,
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

/// Strip model reasoning markers from assistant content before showing it in the UI.
/// Handles both:
///   - Gemma4:           <|channel>thought ... <channel|>
///   - Qwen3/DeepSeek:   <think> ... </think>
fn strip_thinking_blocks(input: &str) -> String {
    let mut output = input.to_string();

    loop {
        if let Some(start) = output.find("<|channel>thought") {
            if let Some(end) = output.find("<channel|>") {
                let end = end + "<channel|>".len();
                output.replace_range(start..end, "");
            } else {
                output.truncate(start);
                break;
            }
        } else {
            break;
        }
    }

    loop {
        if let Some(start) = output.find("<think>") {
            if let Some(end) = output[start..].find("</think>") {
                let end = start + end + "</think>".len();
                output.replace_range(start..end, "");
            } else {
                output.truncate(start);
                break;
            }
        } else {
            break;
        }
    }

    output.trim_start().to_string()
}

async fn get_current_timestamp_fn() -> String {
    let now: DateTime<Utc> = Utc::now();
    format!("ISO: {}, Unix: {}", now.to_rfc3339(), now.timestamp())
}

async fn calculate_timestamp_fn(expression: String) -> String {
    let now: DateTime<Utc> = Utc::now();
    let expr = expression.to_lowercase();

    let res = if expr.contains("ago") {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() >= 2 {
            if let Ok(num) = parts[0].parse::<i64>() {
                let duration = match parts[1] {
                    "day" | "days" => Some(Duration::days(num)),
                    "hour" | "hours" => Some(Duration::hours(num)),
                    "minute" | "minutes" => Some(Duration::minutes(num)),
                    "week" | "weeks" => Some(Duration::weeks(num)),
                    _ => None,
                };
                duration.map(|d| now - d)
            } else {
                None
            }
        } else {
            None
        }
    } else if expr.contains("next") {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() >= 2 {
            let target_weekday = match parts[1] {
                "monday" => Some(chrono::Weekday::Mon),
                "tuesday" => Some(chrono::Weekday::Tue),
                "wednesday" => Some(chrono::Weekday::Wed),
                "thursday" => Some(chrono::Weekday::Thu),
                "friday" => Some(chrono::Weekday::Fri),
                "saturday" => Some(chrono::Weekday::Sat),
                "sunday" => Some(chrono::Weekday::Sun),
                _ => None,
            };
            target_weekday.map(|tw| {
                let mut current = now + Duration::days(1);
                while current.weekday() != tw {
                    current = current + Duration::days(1);
                }
                current
            })
        } else {
            None
        }
    } else if expr == "yesterday" {
        Some(now - Duration::days(1))
    } else if expr == "tomorrow" {
        Some(now + Duration::days(1))
    } else {
        None
    };

    match res {
        Some(r) => format!("Calculated: {}", r.to_rfc3339()),
        None => "Error: Unsupported or invalid expression. Try '3 days ago', 'next friday', 'yesterday', 'tomorrow'.".to_string(),
    }
}

#[tauri::command]
async fn get_local_models() -> Result<Vec<ModelDetails>, String> {
    let ollama = Ollama::default();
    let models = ollama
        .list_local_models()
        .await
        .map_err(|e| e.to_string())?;

    let details = models
        .into_iter()
        .map(|model| {
            let name_lower = model.name.to_lowercase();
            let supports_vision = VISION_MODEL_KEYWORDS
                .iter()
                .any(|s| name_lower.contains(s));
            ModelDetails {
                name: model.name,
                families: Vec::new(),
                supports_vision,
            }
        })
        .collect();

    Ok(details)
}

#[tauri::command]
async fn pull_model(app_handle: AppHandle, model: String) -> Result<(), String> {
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
            Err(e) => return Err(e.to_string()),
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
    #[serde(rename = "type")]
    content_type: String,
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    attachments: Option<Vec<ChatAttachment>>,
}

fn build_ollama_message(msg: ChatMessage) -> OllamaChatMessage {
    let mut ollama_msg = match msg.role.as_str() {
        "assistant" => OllamaChatMessage::assistant(msg.content),
        _ => OllamaChatMessage::user(msg.content),
    };

    if let Some(attachments) = msg.attachments {
        let images: Vec<Image> = attachments
            .into_iter()
            .filter(|a| a.content_type.starts_with("image/"))
            .filter_map(|a| a.content.map(|c| Image::from_base64(&c)))
            .collect();

        if !images.is_empty() {
            ollama_msg.images = Some(images);
        }
    }

    ollama_msg
}

#[tauri::command]
async fn chat_stream(
    app_handle: AppHandle,
    request_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
) -> Result<(), String> {
    let mut history: Vec<OllamaChatMessage> = Vec::new();

    if let Some(ref prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            history.push(OllamaChatMessage::system(prompt.clone()));
        }
    }

    history.extend(messages.into_iter().map(build_ollama_message));

    let ollama = Ollama::default();
    let mut iteration = 0;
    let max_iterations = 5;

    while iteration < max_iterations {
        iteration += 1;

        let request = ChatMessageRequest::new(model.clone(), history.clone());

        let mut stream = ollama
            .send_chat_messages_stream(request)
            .await
            .map_err(|e| e.to_string())?;

        let mut raw_content = String::new();
        let mut emitted_len = 0;
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut final_metadata: Option<StreamMetadata> = None;
        let mut is_done = false;

        while let Some(res) = stream.next().await {
            match res {
                Ok(response) => {
                    is_done = response.done;

                    if let Some(final_data) = response.final_data {
                        final_metadata = Some(StreamMetadata {
                            prompt_eval_count: Some(final_data.prompt_eval_count),
                            eval_count: Some(final_data.eval_count),
                            total_duration: Some(final_data.total_duration),
                            load_duration: Some(final_data.load_duration),
                            prompt_eval_duration: Some(final_data.prompt_eval_duration),
                            eval_duration: Some(final_data.eval_duration),
                        });
                    }

                    let msg = response.message;
                    if !msg.content.is_empty() {
                        raw_content.push_str(&msg.content);

                        // Emit delta if not doing tool calls yet
                        if tool_calls.is_empty() {
                            let clean_content = strip_thinking_blocks(&raw_content);
                            if clean_content.len() > emitted_len {
                                let delta = &clean_content[emitted_len..];
                                let _ = app_handle.emit(
                                    "chat-chunk",
                                    StreamPayload {
                                        request_id: request_id.clone(),
                                        content: delta.to_string(),
                                        done: false,
                                        metadata: None,
                                    },
                                );
                                emitted_len = clean_content.len();
                            }
                        }
                    }
                    if !msg.tool_calls.is_empty() {
                        tool_calls.extend(msg.tool_calls);
                    }
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "chat-chunk",
                        StreamPayload {
                            request_id: request_id.clone(),
                            content: format!("\nError: {:?}", e),
                            done: true,
                            metadata: None,
                        },
                    );
                    return Err(format!("{:?}", e));
                }
            }
        }

        if !is_done {
            continue;
        }

        if tool_calls.is_empty() {
            let _ = app_handle.emit(
                "chat-chunk",
                StreamPayload {
                    request_id: request_id.clone(),
                    content: String::new(),
                    done: true,
                    metadata: final_metadata,
                },
            );
            return Ok(());
        }

        // Tool call path — push assistant turn and resolve tools
        let mut assistant_msg = OllamaChatMessage::assistant(raw_content.clone());
        assistant_msg.tool_calls = tool_calls.clone();
        history.push(assistant_msg);

        for tool_call in tool_calls {
            let result = match tool_call.function.name.as_str() {
                "get_current_timestamp" => get_current_timestamp_fn().await,
                "calculate_timestamp" => {
                    let expr = tool_call.function.arguments
                        .get("expression")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    calculate_timestamp_fn(expr).await
                }
                name => format!("Error: Tool {} not found", name),
            };
            history.push(OllamaChatMessage::tool(result));
        }
    }

    Ok(())
}

#[tauri::command]
async fn chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
    let all_messages = messages.into_iter().map(build_ollama_message).collect();
    let ollama = Ollama::default();
    let response = ollama
        .send_chat_messages(ChatMessageRequest::new(model, all_messages))
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
