use crate::models::chat::{
    ChatMessage, StreamMetadata, StreamPayload, ToolCallInfo, ToolDefinition,
};
use crate::providers::base::{ChatProvider, ModelCatalog, ProviderType};
use async_trait::async_trait;
use futures::Stream;
use ollama_rs::generation::chat::request::ChatMessageRequest;
use ollama_rs::generation::chat::ChatMessage as OllamaChatMessage;
use ollama_rs::generation::parameters::{FormatType, ThinkType};
use ollama_rs::generation::tools::ToolInfo;
use ollama_rs::models::ModelOptions;
use ollama_rs::Ollama;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use std::pin::Pin;
use tokio_stream::StreamExt;

pub struct OllamaProvider {
    client: Ollama,
    _api_key: Option<String>,
}

impl OllamaProvider {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        let host = if base_url.starts_with("http") {
            base_url
        } else {
            format!("http://{base_url}")
        };

        let mut headers = HeaderMap::new();
        if let Some(ref key) = api_key {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", key)) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        let reqwest_client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(60))
            .no_proxy()
            .build()
            .unwrap_or_default();

        let url = reqwest::Url::parse(&host)
            .unwrap_or_else(|_| reqwest::Url::parse("http://localhost:11434").unwrap());
        let scheme = url.scheme();
        let host_only = url.host_str().unwrap_or("localhost");
        let host_with_scheme = format!("{}://{}", scheme, host_only);
        let port = url.port().unwrap_or(11434);

        if cfg!(debug_assertions) {
            println!(
                "[OllamaProvider] Initializing with host: {}, port: {}",
                host_with_scheme, port
            );
        }

        let client = Ollama::new_with_client(host_with_scheme, port, reqwest_client);

        Self {
            client,
            _api_key: api_key,
        }
    }
}

fn normalize_ollama_error(raw: impl std::fmt::Display) -> String {
    let msg = raw.to_string().to_lowercase();
    normalize_msg(&msg, raw.to_string())
}

fn normalize_ollama_stream_error(raw: impl std::fmt::Debug) -> String {
    let debug = format!("{:?}", raw);
    let msg = debug.to_lowercase();
    normalize_msg(&msg, debug)
}

fn normalize_msg(msg: &str, raw: String) -> String {
    if msg.contains("connection refused") || msg.contains("connect error") {
        return "Ollama is not running. Start Ollama and try again.".to_string();
    }
    if msg.contains("timed out") || msg.contains("timeout") {
        return "Request timed out. Ollama may be overloaded or the model is too large."
            .to_string();
    }
    if msg.contains("model") && (msg.contains("not found") || msg.contains("404")) {
        return "Model not found. Run `ollama pull <model>` to download it.".to_string();
    }
    if msg.contains("internal server error") {
        return "Ollama internal error. Try: 1) Pull the model again, 2) Restart Ollama, 3) Check `ollama logs` for details.".to_string();
    }
    if msg.contains("reqwest") {
        return format!("Network error reaching Ollama: {}", raw);
    }
    raw
}

fn is_gemma_think_token_model(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase().replace('_', "-");
    normalized.contains("gemma4") || normalized.contains("gemma-4")
}

fn think_type_for_model(_model: &str, reasoning_enabled: bool) -> ThinkType {
    if reasoning_enabled {
        ThinkType::True
    } else {
        ThinkType::False
    }
}

fn with_model_thinking_prompt(
    model: &str,
    system_prompt: Option<String>,
    reasoning_enabled: bool,
) -> Option<String> {
    let prompt = system_prompt.unwrap_or_default();
    let prompt = prompt
        .trim_start_matches("<|think|>")
        .trim_start()
        .to_string();

    if reasoning_enabled && is_gemma_think_token_model(model) {
        if prompt.is_empty() {
            Some("<|think|>".to_string())
        } else {
            Some(format!("<|think|>\n{prompt}"))
        }
    } else if prompt.is_empty() {
        None
    } else {
        Some(prompt)
    }
}

#[async_trait]
impl ChatProvider for OllamaProvider {
    async fn chat_completion(
        &self,
        model: String,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        options: Option<serde_json::Value>,
        tools: Option<Vec<ToolDefinition>>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamPayload, String>> + Send>>, String> {
        let reasoning_enabled = options
            .as_ref()
            .and_then(|opt| opt.get("reasoning_enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut history: Vec<OllamaChatMessage> = Vec::new();

        if let Some(prompt) = with_model_thinking_prompt(&model, system_prompt, reasoning_enabled) {
            history.push(OllamaChatMessage::system(prompt));
        }

        for msg in messages {
            let mut ollama_msg = match msg.role.as_str() {
                "assistant" => {
                    let mut m = OllamaChatMessage::assistant(msg.content);
                    if let Some(tcs) = msg.tool_calls {
                        if !tcs.is_empty() {
                            m.tool_calls = tcs
                                .into_iter()
                                .map(|tc| ollama_rs::generation::tools::ToolCall {
                                    function: ollama_rs::generation::tools::ToolCallFunction {
                                        name: tc.name,
                                        arguments: tc.arguments,
                                    },
                                })
                                .collect();
                        }
                    }
                    m
                }
                "tool" => OllamaChatMessage::tool(msg.content),
                _ => OllamaChatMessage::user(msg.content),
            };

            if let Some(attachments) = msg.attachments {
                let images: Vec<ollama_rs::generation::images::Image> = attachments
                    .into_iter()
                    .filter(|a| a.content_type.starts_with("image/"))
                    .filter_map(|a| {
                        a.content
                            .map(|c| ollama_rs::generation::images::Image::from_base64(&c))
                    })
                    .collect();
                if !images.is_empty() {
                    ollama_msg.images = Some(images);
                }
            }

            history.push(ollama_msg);
        }

        let mut request = ChatMessageRequest::new(model.clone(), history);

        if let Some(mut opt) = options {
            request.think = Some(think_type_for_model(&model, reasoning_enabled));
            if let Some(object) = opt.as_object_mut() {
                object.remove("reasoning_enabled");
            }

            if let Some(format) = opt.get("format").and_then(parse_response_format) {
                request.format = Some(format);
                if let Some(object) = opt.as_object_mut() {
                    object.remove("format");
                }
            }

            if let Ok(model_opts) = serde_json::from_value::<ModelOptions>(opt) {
                request.options = Some(model_opts);
            }
        } else {
            request.think = Some(think_type_for_model(&model, false));
        }

        if let Some(tool_defs) = tools {
            let ollama_tools: Vec<ToolInfo> = tool_defs
                .into_iter()
                .filter_map(|t| {
                    serde_json::from_value(serde_json::json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    }))
                    .ok()
                })
                .collect();
            if !ollama_tools.is_empty() {
                request.tools = ollama_tools;
            }
        }

        let stream = self
            .client
            .send_chat_messages_stream(request)
            .await
            .map_err(normalize_ollama_error)?;

        let model_clone = model.clone();
        let mapped_stream = stream.map(move |result| match result {
            Ok(response) => {
                let mut metadata = None;
                if let Some(fd) = response.final_data {
                    metadata = Some(StreamMetadata {
                        prompt_eval_count: Some(fd.prompt_eval_count),
                        eval_count: Some(fd.eval_count),
                        total_duration: Some(fd.total_duration),
                        load_duration: Some(fd.load_duration),
                        prompt_eval_duration: Some(fd.prompt_eval_duration),
                        eval_duration: Some(fd.eval_duration),
                        model: model_clone.clone(),
                    });
                }

                let tool_calls = if response.message.tool_calls.is_empty() {
                    None
                } else {
                    Some(
                        response
                            .message
                            .tool_calls
                            .into_iter()
                            .map(|tc| ToolCallInfo {
                                id: None,
                                name: tc.function.name,
                                arguments: tc.function.arguments,
                            })
                            .collect(),
                    )
                };

                Ok(StreamPayload {
                    request_id: String::new(),
                    content: response.message.content,
                    thinking: response.message.thinking,
                    done: response.done,
                    metadata,
                    tool_calls,
                    error: None,
                })
            }
            Err(e) => Err(normalize_ollama_stream_error(e)),
        });

        Ok(Box::pin(mapped_stream))
    }

    fn get_provider_name(&self) -> String {
        "Ollama".to_string()
    }
}

#[async_trait]
impl ModelCatalog for OllamaProvider {
    async fn get_available_models(&self) -> Result<Vec<crate::models::chat::ModelDetails>, String> {
        self.client
            .list_local_models()
            .await
            .map_err(normalize_ollama_error)
            .map(|models| {
                models
                    .into_iter()
                    .map(|m| crate::models::chat::ModelDetails {
                        name: m.name,
                        families: Vec::new(),
                        size: m.size,
                        provider_type: ProviderType::OllamaLocal,
                        provider_config_id: None,
                    })
                    .collect()
            })
    }
}

fn parse_response_format(value: &serde_json::Value) -> Option<FormatType> {
    serde_json::from_value(value.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_schema_response_formats() {
        assert!(matches!(
            parse_response_format(&serde_json::json!("json")),
            Some(FormatType::Json)
        ));
        assert!(matches!(
            parse_response_format(&serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" }
                },
                "required": ["title"]
            })),
            Some(FormatType::StructuredJson(_))
        ));
    }

    #[test]
    fn sends_correct_think_type() {
        assert!(matches!(
            think_type_for_model("llama3.2", true),
            ThinkType::True
        ));
        assert!(matches!(
            think_type_for_model("deepseek-r1", true),
            ThinkType::True
        ));
        assert!(matches!(
            think_type_for_model("llama3.2", false),
            ThinkType::False
        ));
        assert!(matches!(
            think_type_for_model("deepseek-r1", false),
            ThinkType::False
        ));
    }
}
