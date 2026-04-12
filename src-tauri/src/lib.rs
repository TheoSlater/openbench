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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    /// Monotonically increasing. Bumped on cancel; in-flight streams compare
    /// against the value they captured at start and abort if it changed.
    current_generation_id: AtomicUsize,
}

// ---------------------------------------------------------------------------
// Serialisable types emitted via Tauri events
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
struct StreamMetadata {
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
    total_duration: Option<u64>,
    load_duration: Option<u64>,
    prompt_eval_duration: Option<u64>,
    eval_duration: Option<u64>,
}

/// Emitted on the "chat-chunk" event for every content delta and the final done=true frame.
#[derive(serde::Serialize, Clone)]
struct StreamPayload {
    request_id: String,
    content: String,
    done: bool,
    metadata: Option<StreamMetadata>,
}

/// Emitted on the "chat-thinking" event whenever the model's native thinking
/// field carries new data. The frontend accumulates these independently from
/// the content stream so the UI can show a live reasoning trace.
#[derive(serde::Serialize, Clone)]
struct ThinkingPayload {
    request_id: String,
    /// Full accumulated thinking text up to this point.
    thinking: String,
    /// True while the model is still inside its reasoning block.
    is_thinking: bool,
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
    pub size: u64,
}

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

async fn get_current_timestamp_fn() -> String {
    let now: DateTime<Utc> = Utc::now();
    format!("ISO: {}, Unix: {}", now.to_rfc3339(), now.timestamp())
}

async fn calculate_timestamp_fn(expression: String) -> String {
    let now: DateTime<Utc> = Utc::now();
    let expr = expression.to_lowercase();

    let result = if expr.contains("ago") {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() >= 2 {
            parts[0].parse::<i64>().ok().and_then(|num| {
                let duration = match parts[1] {
                    "day" | "days" => Some(Duration::days(num)),
                    "hour" | "hours" => Some(Duration::hours(num)),
                    "minute" | "minutes" => Some(Duration::minutes(num)),
                    "week" | "weeks" => Some(Duration::weeks(num)),
                    _ => None,
                };
                duration.map(|d| now - d)
            })
        } else {
            None
        }
    } else if expr.contains("next") {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() >= 2 {
            let target = match parts[1] {
                "monday" => Some(chrono::Weekday::Mon),
                "tuesday" => Some(chrono::Weekday::Tue),
                "wednesday" => Some(chrono::Weekday::Wed),
                "thursday" => Some(chrono::Weekday::Thu),
                "friday" => Some(chrono::Weekday::Fri),
                "saturday" => Some(chrono::Weekday::Sat),
                "sunday" => Some(chrono::Weekday::Sun),
                _ => None,
            };
            target.map(|tw| {
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

    match result {
        Some(dt) => format!("Calculated: {}", dt.to_rfc3339()),
        None => "Error: Unsupported expression. Try '3 days ago', 'next friday', 'yesterday', 'tomorrow'.".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_local_models() -> Result<Vec<ModelDetails>, String> {
    let ollama = Ollama::default();
    let models = ollama
        .list_local_models()
        .await
        .map_err(|e| e.to_string())?;

    let details = models
        .into_iter()
        .map(|m| {
            let name_lower = m.name.to_lowercase();
            let supports_vision = VISION_MODEL_KEYWORDS
                .iter()
                .any(|kw| name_lower.contains(kw));
            ModelDetails {
                name: m.name,
                families: Vec::new(),
                supports_vision,
                size: m.size,
            }
        })
        .collect();

    Ok(details)
}

#[tauri::command]
async fn delete_model(model: String) -> Result<(), String> {
    let ollama = Ollama::default();
    ollama
        .delete_model(model)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
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

// ---------------------------------------------------------------------------
// Message deserialization
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// chat_stream — the main streaming command
//
// Key design:
//  - Uses ollama-rs 0.3's native ChatMessage::thinking field instead of
//    parsing <think> tags in the accumulated buffer. This is cleaner and
//    model-agnostic — the Ollama server already handles tag extraction for
//    all supported thinking models (qwen3, deepseek-r1, gemma4, etc.).
//  - Thinking content and response content are emitted on separate Tauri
//    events ("chat-thinking" and "chat-chunk") so the frontend can render
//    them independently without any post-processing.
//  - Thinking is accumulated server-side so each "chat-thinking" event
//    contains the *full* thinking text up to that point, not just deltas.
//    The frontend therefore doesn't need to do its own accumulation logic.
//  - Tool calling still works: the assistant turn (with tool_calls) and
//    subsequent tool results are appended to history for the next iteration.
// ---------------------------------------------------------------------------

#[tauri::command]
async fn chat_stream(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    request_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
) -> Result<(), String> {
    // Capture the generation ID at the start. We'll check it before emitting
    // each event; if it has changed, a cancel was requested.
    let my_generation_id = state.current_generation_id.load(Ordering::SeqCst);

    macro_rules! is_cancelled {
        () => {
            state.current_generation_id.load(Ordering::SeqCst) != my_generation_id
        };
    }

    // Build the initial history
    let mut history: Vec<OllamaChatMessage> = Vec::new();

    if let Some(ref prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            history.push(OllamaChatMessage::system(prompt.clone()));
        }
    }
    history.extend(messages.into_iter().map(build_ollama_message));

    let ollama = Ollama::default();
    let max_iterations = 5;

    for _iteration in 0..max_iterations {
        if is_cancelled!() {
            return Ok(());
        }

        let request = ChatMessageRequest::new(model.clone(), history.clone());

        let mut stream = ollama
            .send_chat_messages_stream(request)
            .await
            .map_err(|e| e.to_string())?;

        // Accumulators for this iteration
        let mut content_acc = String::new();
        let mut thinking_acc = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();
        let mut final_metadata: Option<StreamMetadata> = None;
        let mut stream_done = false;

        while let Some(res) = stream.next().await {
            if is_cancelled!() {
                return Ok(());
            }

            match res {
                Ok(response) => {
                    stream_done = response.done;

                    // Collect final stats from the terminal frame
                    if let Some(fd) = response.final_data {
                        final_metadata = Some(StreamMetadata {
                            prompt_eval_count: Some(fd.prompt_eval_count),
                            eval_count: Some(fd.eval_count),
                            total_duration: Some(fd.total_duration),
                            load_duration: Some(fd.load_duration),
                            prompt_eval_duration: Some(fd.prompt_eval_duration),
                            eval_duration: Some(fd.eval_duration),
                        });
                    }

                    let msg = response.message;

                    // ── Thinking field (native Ollama API, ollama-rs 0.3+) ──────────
                    // The `thinking` field on ChatMessage carries the model's reasoning
                    // text as a proper API value — no tag parsing required. We accumulate
                    // it and emit the running total on every update so the frontend can
                    // render a live reasoning trace.
                    if let Some(ref thinking_chunk) = msg.thinking {
                        if !thinking_chunk.is_empty() {
                            thinking_acc.push_str(thinking_chunk);

                            // is_thinking=true while content_acc is still empty
                            // (i.e. the model hasn't started its response yet).
                            let is_thinking = content_acc.is_empty();

                            let _ = app_handle.emit(
                                "chat-thinking",
                                ThinkingPayload {
                                    request_id: request_id.clone(),
                                    thinking: thinking_acc.clone(),
                                    is_thinking,
                                },
                            );
                        }
                    }

                    // ── Content / tool calls ────────────────────────────────────────
                    if !msg.content.is_empty() {
                        content_acc.push_str(&msg.content);

                        // Only emit content deltas; tool-call iterations don't
                        // stream content until after all tools have resolved.
                        if tool_calls.is_empty() {
                            let _ = app_handle.emit(
                                "chat-chunk",
                                StreamPayload {
                                    request_id: request_id.clone(),
                                    content: msg.content.clone(),
                                    done: false,
                                    metadata: None,
                                },
                            );
                        }
                    }

                    if !msg.tool_calls.is_empty() {
                        tool_calls.extend(msg.tool_calls);
                    }
                }

                Err(_) => {
                    // ollama-rs 0.3 stream errors are () — emit a generic message
                    let _ = app_handle.emit(
                        "chat-chunk",
                        StreamPayload {
                            request_id: request_id.clone(),
                            content: "\nError: stream error from Ollama".to_string(),
                            done: true,
                            metadata: None,
                        },
                    );
                    return Err("stream error from Ollama".to_string());
                }
            }
        }

        if !stream_done {
            // Stream ended before Ollama sent done=true — retry the iteration
            continue;
        }

        // ── No tool calls: we're done ────────────────────────────────────────
        if tool_calls.is_empty() {
            // If we had thinking content but is_thinking was still true at
            // stream end (edge case: model thought but never emitted content),
            // emit a final thinking update with is_thinking=false.
            if !thinking_acc.is_empty() && content_acc.is_empty() {
                let _ = app_handle.emit(
                    "chat-thinking",
                    ThinkingPayload {
                        request_id: request_id.clone(),
                        thinking: thinking_acc.clone(),
                        is_thinking: false,
                    },
                );
            }

            // Terminal done=true chunk (empty content, carries metadata)
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

        // ── Tool call path ───────────────────────────────────────────────────
        // Push the assistant's turn (with its tool_calls) so the model has
        // full context on the next iteration, then resolve each tool and
        // append the results.
        let mut assistant_msg = OllamaChatMessage::assistant(content_acc.clone());
        assistant_msg.tool_calls = tool_calls.clone();
        history.push(assistant_msg);

        for tool_call in &tool_calls {
            let result = match tool_call.function.name.as_str() {
                "get_current_timestamp" => get_current_timestamp_fn().await,
                "calculate_timestamp" => {
                    let expr = tool_call
                        .function
                        .arguments
                        .get("expression")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    calculate_timestamp_fn(expr).await
                }
                name => format!("Error: Tool '{name}' not found"),
            };
            history.push(OllamaChatMessage::tool(result));
        }

        // Reset accumulators for the next iteration
        content_acc.clear();
        thinking_acc.clear();
        tool_calls.clear();
        final_metadata = None;
    }

    // Reached max_iterations without a clean finish — emit done so the
    // frontend doesn't hang in a streaming state indefinitely.
    let _ = app_handle.emit(
        "chat-chunk",
        StreamPayload {
            request_id: request_id.clone(),
            content: String::new(),
            done: true,
            metadata: None,
        },
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Non-streaming chat (used for auto-rename, one-shot queries)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
            delete_model,
            chat_stream,
            chat,
            cancel_chat,
            auth::auth_signup,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_get_current_user,
            auth::auth_update_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
