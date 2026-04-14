mod auth;
mod db;
mod tools;

use ollama_rs::generation::chat::request::ChatMessageRequest;
use ollama_rs::generation::chat::ChatMessage as OllamaChatMessage;
use ollama_rs::generation::images::Image;
use ollama_rs::generation::tools::{ToolInfo, ToolType, ToolFunctionInfo};
use ollama_rs::Ollama;
use schemars::Schema;
use tauri::{AppHandle, Emitter};
use tokio_stream::StreamExt;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::collections::HashMap;
use tokio::sync::oneshot;

use tools::{SharedToolRegistry, ToolApprovalResponse, ToolDefinition, ToolInvocationPayload};

/// # OpenBench Backend Core
/// 
/// This module handles the main Tauri application logic, including model management,
/// chat streaming, and tool execution orchestration.
/// 
/// The architecture follows these principles:
/// 1. **Local-First**: Interactions are routed to a local Ollama instance by default.
/// 2. **Streaming-Centric**: All model interactions use async streams to provide a snappy UI.
/// 3. **Tool-Enabled**: Supports dynamic tool invocation via a Rust-based registry.


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

struct PendingApproval {
    sender: oneshot::Sender<bool>,
    tool_name: String,
}

/// Global application state managed by Tauri.
struct AppState {
    /// Monotonically increasing ID used to track the current generation.
    /// When a user cancels a chat, this is incremented, signaling in-flight
    /// streams to abort.
    current_generation_id: AtomicUsize,
    /// Flag to signal cancellation of a model pull operation.
    is_pull_cancelled: AtomicBool,
    /// The centralized registry for all executable tools (MCP-compatible).
    tool_registry: SharedToolRegistry,
    /// Channels for pending tool approvals from the frontend.
    pending_approvals: Mutex<HashMap<String, PendingApproval>>,
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
    model: String,
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
// Tauri commands — models
// ---------------------------------------------------------------------------

/// Returns a list of all models currently installed in the local Ollama instance.
/// Detects vision capabilities based on known model keywords.
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
async fn pull_model(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    state.is_pull_cancelled.store(false, Ordering::SeqCst);
    let ollama = Ollama::default();
    let mut stream = ollama
        .pull_model_stream(model, false)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(res) = stream.next().await {
        if state.is_pull_cancelled.load(Ordering::SeqCst) {
            return Err("Pull cancelled by user".to_string());
        }
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

// ---------------------------------------------------------------------------
// Tauri commands — cancellation
// ---------------------------------------------------------------------------

#[tauri::command]
fn cancel_chat(state: tauri::State<'_, AppState>) {
    state.current_generation_id.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
fn cancel_pull(state: tauri::State<'_, AppState>) {
    state.is_pull_cancelled.store(true, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// Tauri commands — tool registry
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_tools(state: tauri::State<'_, AppState>) -> Result<Vec<ToolDefinition>, String> {
    Ok(state.tool_registry.list_tools().await)
}

#[tauri::command]
async fn toggle_tool(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<Option<bool>, String> {
    Ok(state.tool_registry.toggle_tool(&name).await)
}

#[tauri::command]
async fn approve_tool(
    state: tauri::State<'_, AppState>,
    response: ToolApprovalResponse,
) -> Result<(), String> {
    let pending = {
        let mut approvals = state.pending_approvals.lock().map_err(|e| e.to_string())?;
        approvals.remove(&response.invocation_id)
    };

    if let Some(pending) = pending {
        if response.always_allow && response.approved {
            state
                .tool_registry
                .set_always_allowed(&pending.tool_name, true)
                .await;
        }
        let _ = pending.sender.send(response.approved);
    }

    Ok(())
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
//  - Tool calling now uses the ToolRegistry for dynamic dispatch. Tool
//    definitions are sent to Ollama via ChatMessageRequest::tools() so
//    models actually know what tools are available.
//  - Tools requiring approval emit a "tool-invocation" event and wait
//    for the frontend to respond before executing.
// ---------------------------------------------------------------------------

#[tauri::command]
async fn chat_stream(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    request_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    max_tool_iterations: Option<u32>,
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
    let max_iterations = max_tool_iterations.unwrap_or(5);

    // Get tool definitions from the registry to send to the model.
    let tool_defs = state.tool_registry.to_ollama_tool_json().await;

    for _iteration in 0..max_iterations {
        if is_cancelled!() {
            return Ok(());
        }

        let mut request = ChatMessageRequest::new(model.clone(), history.clone());

        // Attach tool definitions so the model knows what's available.
        if !tool_defs.is_empty() {
            let ollama_tools: Vec<ToolInfo> = tool_defs
                .iter()
                .filter_map(|t| {
                    let func = t.get("function")?;
                    let params_value = func.get("parameters")?.clone();
                    let schema: Schema = serde_json::from_value(params_value).ok()?;
                    Some(ToolInfo {
                        tool_type: ToolType::Function,
                        function: ToolFunctionInfo {
                            name: func.get("name")?.as_str()?.to_string(),
                            description: func.get("description")?.as_str()?.to_string(),
                            parameters: schema,
                        },
                    })
                })
                .collect();
            if !ollama_tools.is_empty() {
                request.tools = ollama_tools;
            }
        }

        let mut stream = ollama
            .send_chat_messages_stream(request)
            .await
            .map_err(|e| e.to_string())?;

        // Accumulators for this iteration
        let mut content_acc = String::new();
        let mut thinking_acc = String::new();
        let mut tool_calls: Vec<ollama_rs::generation::tools::ToolCall> = Vec::new();
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
                            model: model.clone(),
                        });
                    }

                    let msg = response.message;

                    // ── Thinking field (native Ollama API, ollama-rs 0.3+) ──────────
                    if let Some(ref thinking_chunk) = msg.thinking {
                        if !thinking_chunk.is_empty() {
                            thinking_acc.push_str(thinking_chunk);

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
                    let err_msg =
                        "\nError: Stream interrupted or failed in Ollama".to_string();
                    let _ = app_handle.emit(
                        "chat-chunk",
                        StreamPayload {
                            request_id: request_id.clone(),
                            content: err_msg.clone(),
                            done: true,
                            metadata: None,
                        },
                    );
                    return Err(err_msg);
                }
            }
        }

        if !stream_done {
            continue;
        }

        // ── No tool calls: we're done ────────────────────────────────────────
        if tool_calls.is_empty() {
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

        // ── Tool call path — dispatch via registry ───────────────────────────
        let mut assistant_msg = OllamaChatMessage::assistant(content_acc.clone());
        assistant_msg.tool_calls = tool_calls.clone();
        history.push(assistant_msg);

        for tool_call in &tool_calls {
            let tool_name = &tool_call.function.name;
            // ToolCallFunction.arguments is a serde_json::Value (usually an Object)
            let tool_args = tool_call.function.arguments.clone();

            // Emit tool invocation event so the frontend can show status.
            let invocation_id = uuid::Uuid::new_v4().to_string();
            let needs_approval = state.tool_registry.needs_approval(tool_name).await;

            if needs_approval {
                let (tx, rx) = oneshot::channel();
                {
                    let mut approvals = state.pending_approvals.lock().map_err(|e| e.to_string())?;
                    approvals.insert(invocation_id.clone(), PendingApproval {
                        sender: tx,
                        tool_name: tool_name.clone(),
                    });
                }

                let _ = app_handle.emit(
                    "tool-invocation",
                    ToolInvocationPayload {
                        invocation_id: invocation_id.clone(),
                        request_id: request_id.clone(),
                        tool_name: tool_name.clone(),
                        tool_args: tool_args.clone(),
                        requires_approval: true,
                    },
                );

                // Wait for approval from the frontend
                let approved = rx.await.map_err(|_| "Approval channel closed".to_string())?;

                if !approved {
                    history.push(OllamaChatMessage::tool("Tool invocation denied by user".to_string()));
                    continue;
                }
            } else {
                let _ = app_handle.emit(
                    "tool-invocation",
                    ToolInvocationPayload {
                        invocation_id: invocation_id.clone(),
                        request_id: request_id.clone(),
                        tool_name: tool_name.clone(),
                        tool_args: tool_args.clone(),
                        requires_approval: false,
                    },
                );
            }

            let result = state
                .tool_registry
                .execute(tool_name, tool_args)
                .await;

            history.push(OllamaChatMessage::tool(result.output));
        }

        // Reset accumulators for the next iteration
        content_acc.clear();
        thinking_acc.clear();
        tool_calls.clear();
    }

    // Reached max_iterations — emit done so the frontend doesn't hang.
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
            is_pull_cancelled: AtomicBool::new(false),
            tool_registry: SharedToolRegistry::new(),
            pending_approvals: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_local_models,
            pull_model,
            delete_model,
            chat_stream,
            chat,
            cancel_chat,
            cancel_pull,
            list_tools,
            toggle_tool,
            approve_tool,
            auth::auth_signup,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_get_current_user,
            auth::auth_update_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
