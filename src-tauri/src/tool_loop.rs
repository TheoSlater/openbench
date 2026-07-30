use crate::error::AppError;
use crate::models::chat::{
    ChatMessage, SearchResultItem, StreamMetadata, StreamPayload, ThinkingPayload, ToolCallInfo,
    ToolDefinition, WebSearchEvent,
};
use crate::providers::base::ChatProvider;
use crate::stream_emitter::StreamEmitter;
use crate::web_search::{WebSearchClient, WebSearchConfig};
use tokio_stream::StreamExt;
use tokio_util::sync::CancellationToken;

fn format_search_results(query: &str, results: &[SearchResultItem], error: Option<&str>) -> String {
    let mut output = String::new();
    if let Some(err) = error {
        output.push_str(&format!("Web search for \"{}\" failed: {}\n", query, err));
        return output;
    }
    if results.is_empty() {
        output.push_str(&format!(
            "Web search for \"{}\" returned no results.\n",
            query
        ));
        return output;
    }
    output.push_str(&format!(
        "Web search results for \"{}\" ({} sources):\n\n",
        query,
        results.len()
    ));
    for (i, r) in results.iter().enumerate() {
        output.push_str(&format!("[{}. {}]({})\n", i + 1, r.title, r.url));
        for h in &r.highlights {
            output.push_str(&format!("   > {}\n", h));
        }
        output.push('\n');
    }
    output
}

const THINK_START_TAGS: [&str; 2] = ["<think>", "<|channel>thought"];
const THINK_END_TAGS: [&str; 2] = ["</think>", "<channel|>"];

struct ThinkingTagParser {
    enabled: bool,
    in_thinking: bool,
    buffer: String,
}

impl ThinkingTagParser {
    fn new(enabled: bool) -> Self {
        Self {
            enabled,
            in_thinking: false,
            buffer: String::new(),
        }
    }

    fn push(&mut self, chunk: &str) -> (String, String) {
        if !self.enabled {
            return (chunk.to_string(), String::new());
        }
        self.buffer.push_str(chunk);
        self.drain(false)
    }

    fn finish(&mut self) -> (String, String) {
        if !self.enabled {
            return (String::new(), String::new());
        }
        let drained = self.drain(true);
        self.in_thinking = false;
        drained
    }

    fn drain(&mut self, finish: bool) -> (String, String) {
        let mut content = String::new();
        let mut thinking = String::new();
        loop {
            if self.in_thinking {
                if let Some((idx, tag)) = find_first_tag(&self.buffer, &THINK_END_TAGS) {
                    thinking.push_str(&self.buffer[..idx]);
                    self.buffer.drain(..idx + tag.len());
                    self.in_thinking = false;
                    continue;
                }
                let keep = if finish {
                    0
                } else {
                    THINK_END_TAGS
                        .iter()
                        .map(|t| t.len())
                        .max()
                        .unwrap_or(0)
                        .saturating_sub(1)
                };
                if self.buffer.len() > keep {
                    let split_at = safe_split_index(&self.buffer, self.buffer.len() - keep);
                    thinking.push_str(&self.buffer[..split_at]);
                    self.buffer.drain(..split_at);
                }
                break;
            }
            if let Some((idx, tag)) = find_first_tag(&self.buffer, &THINK_START_TAGS) {
                content.push_str(&self.buffer[..idx]);
                self.buffer.drain(..idx + tag.len());
                self.in_thinking = true;
                if self.buffer.starts_with('\n') {
                    self.buffer.drain(..1);
                }
                continue;
            }
            let keep = if finish {
                0
            } else {
                THINK_START_TAGS
                    .iter()
                    .map(|t| t.len())
                    .max()
                    .unwrap_or(0)
                    .saturating_sub(1)
            };
            if self.buffer.len() > keep {
                let split_at = safe_split_index(&self.buffer, self.buffer.len() - keep);
                content.push_str(&self.buffer[..split_at]);
                self.buffer.drain(..split_at);
            }
            break;
        }
        if finish && !self.buffer.is_empty() {
            if self.in_thinking {
                thinking.push_str(&self.buffer);
            } else {
                content.push_str(&self.buffer);
            }
            self.buffer.clear();
        }
        (content, thinking)
    }
}

fn find_first_tag<'a>(haystack: &str, tags: &'a [&str]) -> Option<(usize, &'a str)> {
    tags.iter()
        .filter_map(|tag| haystack.find(tag).map(|idx| (idx, *tag)))
        .min_by_key(|(idx, _)| *idx)
}

fn safe_split_index(value: &str, max: usize) -> usize {
    let mut idx = max.min(value.len());
    while idx > 0 && !value.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

#[allow(dead_code)]
pub struct ToolLoopResult {
    pub content: String,
    pub thinking: String,
    pub metadata: Option<StreamMetadata>,
}

pub struct ToolLoop;

impl ToolLoop {
    #[allow(clippy::too_many_arguments)]
    pub async fn run(
        provider: &dyn ChatProvider,
        model: &str,
        initial_messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        reasoning_enabled: bool,
        request_id: &str,
        emitter: &dyn StreamEmitter,
        web_search: Option<(&dyn WebSearchClient, &WebSearchConfig)>,
        cancellation: CancellationToken,
    ) -> Result<ToolLoopResult, AppError> {
        let web_search_tool = ToolDefinition {
            name: "web_search".into(),
            description: "Search the web for current information. Use this when you need up-to-date information, recent events, or facts outside your training data.".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": { "query": { "type": "string", "description": "The search query to look up" } },
                "required": ["query"]
            }),
        };

        let tools_enabled = web_search
            .filter(|(_, config)| config.is_configured())
            .is_some();

        let mut messages = initial_messages;
        let mut content_acc = String::new();
        let mut thinking_acc = String::new();
        let mut final_metadata: Option<StreamMetadata> = None;
        let mut thinking_parser = ThinkingTagParser::new(reasoning_enabled);

        loop {
            let reasoning_opt = serde_json::json!({"reasoning_enabled": reasoning_enabled});

            // ponytail: tools only sent when web search is configured — the
            // pre-existing gate that keeps non-tool-capable models working.
            let tools = tools_enabled.then(|| vec![web_search_tool.clone()]);

            let mut stream = provider
                .chat_completion(
                    model.to_string(),
                    messages.clone(),
                    system_prompt.clone(),
                    Some(reasoning_opt),
                    tools,
                )
                .await
                .map_err(|e| AppError::Provider(format!("Generation failed: {e}")))?;

            let mut tool_calls_opt: Option<Vec<ToolCallInfo>> = None;
            let mut restart_for_tool_call = false;

            loop {
                let result = tokio::select! {
                    _ = cancellation.cancelled() => {
                        emitter
                            .emit_chunk(&StreamPayload {
                                request_id: request_id.to_string(),
                                content: String::new(),
                                thinking: None,
                                done: true,
                                metadata: None,
                                tool_calls: None,
                                error: None,
                            })
                            .await;
                        return Err(AppError::Cancelled);
                    }
                    result = stream.next() => result,
                };
                let Some(result) = result else { break };
                if cancellation.is_cancelled() {
                    emitter
                        .emit_chunk(&StreamPayload {
                            request_id: request_id.to_string(),
                            content: String::new(),
                            thinking: None,
                            done: true,
                            metadata: None,
                            tool_calls: None,
                            error: None,
                        })
                        .await;
                    return Err(AppError::Cancelled);
                }

                let mut chunk = match result {
                    Ok(c) => c,
                    Err(e) => {
                        emitter
                            .emit_chunk(&StreamPayload {
                                request_id: request_id.to_string(),
                                content: format!("\n\n*Stream error: {e}*"),
                                thinking: None,
                                done: true,
                                metadata: None,
                                tool_calls: None,
                                error: Some(e.clone()),
                            })
                            .await;
                        return Err(AppError::Provider(e));
                    }
                };

                chunk.request_id = request_id.to_string();
                if let Some(ref m) = chunk.metadata {
                    final_metadata = Some(m.clone());
                }
                if let Some(tcs) = chunk.tool_calls.filter(|tcs| !tcs.is_empty()) {
                    tool_calls_opt = Some(tcs);
                }

                // Thinking events carry the full accumulated text (O(n²) IPC, but
                // self-healing: a dropped event can't corrupt the disclosure)
                if let Some(tc) = chunk.thinking.as_ref().filter(|tc| !tc.is_empty()) {
                    thinking_acc.push_str(tc);
                    emitter
                        .emit_thinking(&ThinkingPayload {
                            request_id: request_id.to_string(),
                            thinking: thinking_acc.clone(),
                            is_thinking: content_acc.is_empty(),
                        })
                        .await;
                }

                if !chunk.content.is_empty() {
                    let (cc, tc) = thinking_parser.push(&chunk.content);
                    if !tc.is_empty() {
                        thinking_acc.push_str(&tc);
                        emitter
                            .emit_thinking(&ThinkingPayload {
                                request_id: request_id.to_string(),
                                thinking: thinking_acc.clone(),
                                is_thinking: content_acc.is_empty(),
                            })
                            .await;
                    }
                    content_acc.push_str(&cc);
                    if !cc.is_empty() {
                        emitter
                            .emit_chunk(&StreamPayload {
                                request_id: request_id.to_string(),
                                content: cc,
                                thinking: None,
                                done: false,
                                metadata: None,
                                tool_calls: None,
                                error: None,
                            })
                            .await;
                    }
                }

                if chunk.done {
                    let (cc, tc) = thinking_parser.finish();
                    if !tc.is_empty() {
                        thinking_acc.push_str(&tc);
                        emitter
                            .emit_thinking(&ThinkingPayload {
                                request_id: request_id.to_string(),
                                thinking: thinking_acc.clone(),
                                is_thinking: false,
                            })
                            .await;
                    }
                    if !cc.is_empty() {
                        content_acc.push_str(&cc);
                        emitter
                            .emit_chunk(&StreamPayload {
                                request_id: request_id.to_string(),
                                content: cc,
                                thinking: None,
                                done: false,
                                metadata: None,
                                tool_calls: None,
                                error: None,
                            })
                            .await;
                    }

                    if let Some(Some(tc)) = tool_calls_opt.map(|tcs| tcs.into_iter().next()) {
                        let tool_result = match tc.name.as_str() {
                            "web_search" => {
                                let query = tc
                                    .arguments
                                    .get("query")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                emitter
                                    .emit_web_search(&WebSearchEvent {
                                        request_id: request_id.to_string(),
                                        query: query.clone(),
                                        status: "searching".into(),
                                        results: None,
                                    })
                                    .await;

                                let (search_results, search_error) =
                                    match web_search.filter(|(_, config)| config.is_configured()) {
                                        Some((client, config)) => {
                                            match client.search(&query, &config.api_key).await {
                                                Ok(r) => (r, None),
                                                Err(e) => {
                                                    eprintln!(
                                                        "[WebSearch] {:?} error: {e}",
                                                        client.provider()
                                                    );
                                                    (Vec::new(), Some(e))
                                                }
                                            }
                                        }
                                        None => (
                                            Vec::new(),
                                            Some("No web search provider configured".into()),
                                        ),
                                    };

                                let results_clone = search_results.clone();
                                emitter
                                    .emit_web_search(&WebSearchEvent {
                                        request_id: request_id.to_string(),
                                        query: query.clone(),
                                        status: if search_error.is_some() {
                                            "error".into()
                                        } else {
                                            "complete".into()
                                        },
                                        results: Some(search_results),
                                    })
                                    .await;

                                format_search_results(
                                    &query,
                                    &results_clone,
                                    search_error.as_deref(),
                                )
                            }
                            other => {
                                format!("Unknown tool \"{other}\". Available tools: web_search.")
                            }
                        };

                        messages.push(ChatMessage {
                            role: "assistant".into(),
                            content: content_acc.clone(),
                            attachments: None,
                            tool_calls: Some(vec![tc.clone()]),
                            tool_call_id: None,
                        });
                        messages.push(ChatMessage {
                            role: "tool".into(),
                            content: tool_result,
                            attachments: None,
                            tool_calls: None,
                            tool_call_id: tc.id,
                        });

                        content_acc.clear();
                        thinking_acc.clear();
                        final_metadata = None;
                        thinking_parser = ThinkingTagParser::new(reasoning_enabled);
                        restart_for_tool_call = true;
                        break;
                    }

                    if !thinking_acc.is_empty() && content_acc.is_empty() {
                        emitter
                            .emit_thinking(&ThinkingPayload {
                                request_id: request_id.to_string(),
                                thinking: thinking_acc.clone(),
                                is_thinking: false,
                            })
                            .await;
                    }
                    emitter
                        .emit_chunk(&StreamPayload {
                            request_id: request_id.to_string(),
                            content: String::new(),
                            thinking: None,
                            done: true,
                            metadata: final_metadata.clone(),
                            tool_calls: None,
                            error: None,
                        })
                        .await;
                    return Ok(ToolLoopResult {
                        content: content_acc,
                        thinking: thinking_acc,
                        metadata: final_metadata,
                    });
                }
            }

            // Stream exhausted without a done marker (connection dropped) and no
            // tool call requested a restart — finalize instead of re-issuing the
            // same request forever.
            if !restart_for_tool_call {
                let err = "Stream ended unexpectedly".to_string();
                emitter
                    .emit_chunk(&StreamPayload {
                        request_id: request_id.to_string(),
                        content: String::new(),
                        thinking: None,
                        done: true,
                        metadata: final_metadata.clone(),
                        tool_calls: None,
                        error: Some(err.clone()),
                    })
                    .await;
                return Err(AppError::Provider(err));
            }
        }
    }
}
