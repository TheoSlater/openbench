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

/// Strip all thinking blocks from a completed response string.
/// Handles both:
///   - Gemma4:           <|channel>thought ... <channel|>
///   - Qwen3/DeepSeek:   <think> ... </think>
fn strip_thinking_blocks(input: &str) -> String {
    let mut output = input.to_string();

    // Gemma4
    loop {
        if let Some(start) = output.find("<|channel>thought") {
            if let Some(end) = output.find("<channel|>") {
                let end = end + "<channel|>".len();
                output.replace_range(start..end, "");
            } else {
                // No closing tag — strip from start to end of string
                output.truncate(start);
                break;
            }
        } else {
            break;
        }
    }

    // Qwen3 / DeepSeek-R1
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
                let unit = parts[1];
                let duration = match unit {
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
            families: Vec::new(),
            supports_vision,
        });
    }

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
    content: Option<String>,
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
    _state: tauri::State<'_, AppState>,
    request_id: String,
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

    let mut current_history = Vec::new();
    if let Some(prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            current_history.push(OllamaChatMessage::system(prompt));
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
                        images.push(Image::from_base64(&content));
                    }
                }
            }
            if !images.is_empty() {
                ollama_msg.images = Some(images);
            }
        }
        current_history.push(ollama_msg);
    }

    let mut iteration = 0;
    let max_iterations = 5;

    while iteration < max_iterations {
        iteration += 1;

        let request = ChatMessageRequest::new(model.clone(), current_history.clone());
        let ollama = Ollama::default();
        let mut stream = ollama
            .send_chat_messages_stream(request)
            .await
            .map_err(|e| e.to_string())?;

        // Accumulate the full raw response, then strip thinking blocks before
        // emitting. This avoids any chunk-boundary issues with split markers.
        let mut raw_content = String::new();
        let mut assistant_tool_calls: Vec<ToolCall> = Vec::new();
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
                    }
                    if !msg.tool_calls.is_empty() {
                        assistant_tool_calls.extend(msg.tool_calls);
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

        if is_done {
            let clean_content = strip_thinking_blocks(&raw_content);

            println!(
                "[openbench] stream iteration={} done, raw={} clean={} tool_calls={}",
                iteration,
                raw_content.len(),
                clean_content.len(),
                assistant_tool_calls.len()
            );

            if assistant_tool_calls.is_empty() {
                // Emit the full clean content as one chunk, then signal done
                if !clean_content.is_empty() {
                    let _ = app_handle.emit(
                        "chat-chunk",
                        StreamPayload {
                            request_id: request_id.clone(),
                            content: clean_content,
                            done: false,
                            metadata: None,
                        },
                    );
                }
                let _ = app_handle.emit(
                    "chat-chunk",
                    StreamPayload {
                        request_id: request_id.clone(),
                        content: "".to_string(),
                        done: true,
                        metadata: final_metadata,
                    },
                );
                return Ok(());
            }

            // Tool call path — push assistant turn and loop
            let mut assistant_msg = OllamaChatMessage::assistant(raw_content.clone());
            assistant_msg.tool_calls = assistant_tool_calls.clone();
            current_history.push(assistant_msg);

            for tool_call in assistant_tool_calls {
                let tool_name = tool_call.function.name.clone();
                let arguments = tool_call.function.arguments;

                println!("[openbench] executing tool: {}", tool_name);

                let content = if tool_name == "get_current_timestamp" {
                    get_current_timestamp_fn().await
                } else if tool_name == "calculate_timestamp" {
                    let expr = arguments["expression"].as_str().unwrap_or("").to_string();
                    calculate_timestamp_fn(expr).await
                } else {
                    format!("Error: Tool {} not found", tool_name)
                };

                println!("[openbench] tool result: {}", content);
                current_history.push(OllamaChatMessage::tool(content));
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn chat(model: String, messages: Vec<ChatMessage>) -> Result<String, String> {
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
