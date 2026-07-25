use crate::models::chat::{
    ChatMessage, ModelDetails, StreamMetadata, StreamPayload, ToolCallInfo, ToolDefinition,
};
use crate::providers::base::{ChatProvider, ModelCatalog, ProviderStatus, ProviderType};
use crate::providers::openai_compatible::{extract_error_message, SseParser};
use async_stream::stream;
use async_trait::async_trait;
use futures::Stream;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::pin::Pin;
use tokio_stream::StreamExt;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u64 = 4096;

pub struct AnthropicNativeProvider {
    client: Client,
    base_url: String,
    api_key: String,
}

impl AnthropicNativeProvider {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: normalize_base_url(&base_url),
            api_key: api_key.unwrap_or_default(),
        }
    }

    fn request(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
    }
}

#[async_trait]
impl ChatProvider for AnthropicNativeProvider {
    async fn health_check(&self) -> ProviderStatus {
        let request = self.request(self.client.get(format!("{}/models", self.base_url)));
        match request.send().await {
            Ok(response) if response.status().is_success() => ProviderStatus::Online,
            _ => ProviderStatus::Offline,
        }
    }

    async fn chat_completion(
        &self,
        model: String,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        options: Option<Value>,
        tools: Option<Vec<ToolDefinition>>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamPayload, String>> + Send>>, String> {
        let body = build_request_body(&model, messages, system_prompt, options, tools);
        let request = self.request(
            self.client
                .post(format!("{}/messages", self.base_url))
                .json(&body),
        );
        let response = request.send().await.map_err(normalize_network_error)?;

        if !response.status().is_success() {
            return Err(api_error(response).await);
        }

        let mut bytes = response.bytes_stream();
        let stream_model = model.clone();
        let output = stream! {
            let mut parser = SseParser::default();
            let mut pending_tool_calls = BTreeMap::<u64, PendingToolCall>::new();
            let mut metadata = empty_stream_metadata(&stream_model);

            while let Some(result) = bytes.next().await {
                let chunk = match result {
                    Ok(chunk) => chunk,
                    Err(error) => {
                        yield Err(normalize_network_error(error));
                        return;
                    }
                };

                for event in parser.push_bytes(&chunk) {
                    let value: Value = match serde_json::from_str(&event) {
                        Ok(value) => value,
                        Err(error) => {
                            yield Err(format!("Anthropic stream parse failed: {error}"));
                            return;
                        }
                    };

                    match handle_event(&value, &mut pending_tool_calls, &mut metadata) {
                        EventOutcome::Payload(payload) => yield Ok(payload),
                        EventOutcome::Error(message) => {
                            yield Err(message);
                            return;
                        }
                        EventOutcome::Stop => {
                            yield Ok(done_payload(pending_tool_calls, metadata));
                            return;
                        }
                        EventOutcome::None => {}
                    }
                }
            }

            yield Ok(done_payload(pending_tool_calls, metadata));
        };

        Ok(Box::pin(output))
    }

    fn get_provider_name(&self) -> String {
        "Anthropic".to_string()
    }

    fn get_provider_type(&self) -> ProviderType {
        ProviderType::AnthropicNative
    }
}

#[async_trait]
impl ModelCatalog for AnthropicNativeProvider {
    async fn get_available_models(&self) -> Result<Vec<ModelDetails>, String> {
        let request = self.request(self.client.get(format!("{}/models", self.base_url)));
        let response = request.send().await.map_err(normalize_network_error)?;

        if !response.status().is_success() {
            return Err(api_error(response).await);
        }

        let body: ModelsResponse = response
            .json()
            .await
            .map_err(|error| format!("Anthropic API response parse failed: {error}"))?;

        Ok(body
            .data
            .into_iter()
            .map(|model| ModelDetails {
                name: model.id,
                families: vec!["claude".to_string()],
                size: 0,
                provider_type: ProviderType::AnthropicNative,
                provider_config_id: None,
            })
            .collect())
    }

    fn get_provider_type(&self) -> ProviderType {
        ProviderType::AnthropicNative
    }
}

fn normalize_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn build_request_body(
    model: &str,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    options: Option<Value>,
    tools: Option<Vec<ToolDefinition>>,
) -> Value {
    let max_tokens = options
        .as_ref()
        .and_then(|options| options.get("max_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_MAX_TOKENS);

    let mut body = Map::from_iter([
        ("model".to_string(), json!(model)),
        ("max_tokens".to_string(), json!(max_tokens)),
        ("messages".to_string(), Value::Array(build_messages(messages))),
        ("stream".to_string(), Value::Bool(true)),
    ]);

    if let Some(prompt) = system_prompt.filter(|prompt| !prompt.trim().is_empty()) {
        body.insert("system".to_string(), Value::String(prompt));
    }

    if let Some(temperature) = options.as_ref().and_then(|options| options.get("temperature")) {
        body.insert("temperature".to_string(), temperature.clone());
    }

    if let Some(tools) = tools.filter(|tools| !tools.is_empty()) {
        body.insert(
            "tools".to_string(),
            Value::Array(tools.into_iter().map(tool_definition_value).collect()),
        );
    }

    Value::Object(body)
}

fn tool_definition_value(tool: ToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters,
    })
}

fn build_messages(messages: Vec<ChatMessage>) -> Vec<Value> {
    messages
        .into_iter()
        .map(|message| match message.role.as_str() {
            "assistant" => assistant_message_value(message),
            "tool" => tool_result_message_value(message),
            _ => user_message_value(message),
        })
        .collect()
}

fn assistant_message_value(message: ChatMessage) -> Value {
    let mut content = Vec::new();
    if !message.content.is_empty() {
        content.push(json!({ "type": "text", "text": message.content }));
    }
    for call in message.tool_calls.into_iter().flatten() {
        content.push(json!({
            "type": "tool_use",
            "id": call.id.unwrap_or_else(|| format!("toolu_{}", uuid::Uuid::new_v4())),
            "name": call.name,
            "input": call.arguments,
        }));
    }
    json!({ "role": "assistant", "content": content })
}

fn tool_result_message_value(message: ChatMessage) -> Value {
    json!({
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": message.tool_call_id.unwrap_or_default(),
            "content": message.content,
        }]
    })
}

fn user_message_value(message: ChatMessage) -> Value {
    let mut content = vec![json!({ "type": "text", "text": message.content })];
    content.extend(
        message
            .attachments
            .unwrap_or_default()
            .into_iter()
            .filter(|attachment| attachment.content_type.starts_with("image/"))
            .filter_map(|attachment| {
                attachment.content.map(|data| {
                    json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": attachment.content_type,
                            "data": data,
                        }
                    })
                })
            }),
    );
    json!({ "role": "user", "content": content })
}

enum EventOutcome {
    Payload(StreamPayload),
    Error(String),
    Stop,
    None,
}

#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn handle_event(
    value: &Value,
    pending_tool_calls: &mut BTreeMap<u64, PendingToolCall>,
    metadata: &mut StreamMetadata,
) -> EventOutcome {
    match value.get("type").and_then(Value::as_str) {
        Some("message_start") => {
            if let Some(tokens) = value
                .pointer("/message/usage/input_tokens")
                .and_then(Value::as_u64)
            {
                metadata.prompt_eval_count = Some(tokens);
            }
            EventOutcome::None
        }
        Some("content_block_start") => {
            let Some(index) = value.get("index").and_then(Value::as_u64) else {
                return EventOutcome::None;
            };
            let block = value.get("content_block");
            if block.and_then(|block| block.get("type")).and_then(Value::as_str) == Some("tool_use") {
                let id = block
                    .and_then(|block| block.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let name = block
                    .and_then(|block| block.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                pending_tool_calls.insert(
                    index,
                    PendingToolCall {
                        id,
                        name,
                        arguments: String::new(),
                    },
                );
            }
            EventOutcome::None
        }
        Some("content_block_delta") => {
            let Some(index) = value.get("index").and_then(Value::as_u64) else {
                return EventOutcome::None;
            };
            let delta = value.get("delta");
            match delta.and_then(|delta| delta.get("type")).and_then(Value::as_str) {
                Some("text_delta") => {
                    let text = delta
                        .and_then(|delta| delta.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    EventOutcome::Payload(text_payload(text))
                }
                Some("thinking_delta") => {
                    let thinking = delta
                        .and_then(|delta| delta.get("thinking"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    EventOutcome::Payload(thinking_payload(thinking))
                }
                Some("input_json_delta") => {
                    if let Some(call) = pending_tool_calls.get_mut(&index) {
                        if let Some(partial) = delta
                            .and_then(|delta| delta.get("partial_json"))
                            .and_then(Value::as_str)
                        {
                            call.arguments.push_str(partial);
                        }
                    }
                    EventOutcome::None
                }
                _ => EventOutcome::None,
            }
        }
        Some("message_delta") => {
            if let Some(tokens) = value
                .pointer("/usage/output_tokens")
                .and_then(Value::as_u64)
            {
                metadata.eval_count = Some(tokens);
            }
            EventOutcome::None
        }
        Some("error") => {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("Anthropic API stream error")
                .to_string();
            EventOutcome::Error(message)
        }
        Some("message_stop") => EventOutcome::Stop,
        _ => EventOutcome::None,
    }
}

fn text_payload(content: String) -> StreamPayload {
    StreamPayload {
        request_id: String::new(),
        content,
        thinking: None,
        done: false,
        metadata: None,
        tool_calls: None,
        error: None,
    }
}

fn thinking_payload(thinking: String) -> StreamPayload {
    StreamPayload {
        request_id: String::new(),
        content: String::new(),
        thinking: Some(thinking),
        done: false,
        metadata: None,
        tool_calls: None,
        error: None,
    }
}

fn done_payload(
    pending_tool_calls: BTreeMap<u64, PendingToolCall>,
    metadata: StreamMetadata,
) -> StreamPayload {
    let tool_calls: Vec<ToolCallInfo> = pending_tool_calls
        .into_values()
        .map(|call| ToolCallInfo {
            id: (!call.id.is_empty()).then_some(call.id),
            name: call.name,
            arguments: serde_json::from_str(&call.arguments)
                .unwrap_or_else(|_| Value::String(call.arguments)),
        })
        .collect();

    StreamPayload {
        request_id: String::new(),
        content: String::new(),
        thinking: None,
        done: true,
        metadata: Some(metadata),
        tool_calls: (!tool_calls.is_empty()).then_some(tool_calls),
        error: None,
    }
}

fn empty_stream_metadata(model: &str) -> StreamMetadata {
    StreamMetadata {
        prompt_eval_count: None,
        eval_count: None,
        total_duration: None,
        load_duration: None,
        prompt_eval_duration: None,
        eval_duration: None,
        model: model.to_string(),
    }
}

async fn api_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = extract_error_message(&body).unwrap_or_else(|| body.trim().to_string());
    if message.is_empty() {
        format!("Anthropic API error ({status})")
    } else {
        format!("Anthropic API error ({status}): {message}")
    }
}

fn normalize_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Anthropic API request timed out.".to_string()
    } else {
        format!("Network error reaching Anthropic API: {error}")
    }
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<AnthropicModel>,
}

#[derive(Deserialize)]
struct AnthropicModel {
    id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::chat::ChatMessage;

    #[test]
    fn normalizes_base_url() {
        assert_eq!(
            normalize_base_url("https://api.anthropic.com/v1/"),
            "https://api.anthropic.com/v1"
        );
        assert_eq!(normalize_base_url("api.anthropic.com/v1"), "https://api.anthropic.com/v1");
    }

    #[test]
    fn moves_system_prompt_to_top_level_field() {
        let body = build_request_body(
            "claude-sonnet-4-20250514",
            vec![ChatMessage {
                role: "user".into(),
                content: "Hello".into(),
                attachments: None,
                tool_calls: None,
                tool_call_id: None,
            }],
            Some("Be helpful".into()),
            None,
            None,
        );

        assert_eq!(body["system"], "Be helpful");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"][0]["text"], "Hello");
        assert!(body["messages"].as_array().unwrap().len() == 1);
        assert_eq!(body["max_tokens"], DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn converts_tools_to_input_schema_format() {
        let body = build_request_body(
            "claude-sonnet-4-20250514",
            Vec::new(),
            None,
            None,
            Some(vec![ToolDefinition {
                name: "web_search".into(),
                description: "search the web".into(),
                parameters: json!({ "type": "object", "properties": {} }),
            }]),
        );

        assert_eq!(body["tools"][0]["name"], "web_search");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        assert!(body["tools"][0].get("function").is_none());
    }

    #[test]
    fn converts_tool_result_message_to_anthropic_user_turn() {
        let messages = vec![
            ChatMessage {
                role: "assistant".into(),
                content: String::new(),
                attachments: None,
                tool_calls: Some(vec![ToolCallInfo {
                    id: Some("toolu_123".into()),
                    name: "web_search".into(),
                    arguments: json!({ "query": "news" }),
                }]),
                tool_call_id: None,
            },
            ChatMessage {
                role: "tool".into(),
                content: "result text".into(),
                attachments: None,
                tool_calls: None,
                tool_call_id: Some("toolu_123".into()),
            },
        ];

        let value = build_messages(messages);

        assert_eq!(value[0]["content"][0]["type"], "tool_use");
        assert_eq!(value[0]["content"][0]["id"], "toolu_123");
        assert_eq!(value[1]["role"], "user");
        assert_eq!(value[1]["content"][0]["type"], "tool_result");
        assert_eq!(value[1]["content"][0]["tool_use_id"], "toolu_123");
    }

    #[test]
    fn accumulates_streamed_text_and_tool_call_deltas() {
        let mut pending = BTreeMap::new();
        let mut metadata = empty_stream_metadata("claude-sonnet-4-20250514");

        let start = json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": { "type": "text", "text": "" }
        });
        assert!(matches!(
            handle_event(&start, &mut pending, &mut metadata),
            EventOutcome::None
        ));

        let delta = json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": "Hi" }
        });
        match handle_event(&delta, &mut pending, &mut metadata) {
            EventOutcome::Payload(payload) => assert_eq!(payload.content, "Hi"),
            _ => panic!("expected text payload"),
        }

        let tool_start = json!({
            "type": "content_block_start",
            "index": 1,
            "content_block": { "type": "tool_use", "id": "toolu_1", "name": "web_search" }
        });
        handle_event(&tool_start, &mut pending, &mut metadata);

        let tool_delta = json!({
            "type": "content_block_delta",
            "index": 1,
            "delta": { "type": "input_json_delta", "partial_json": "{\"query\":\"x\"}" }
        });
        handle_event(&tool_delta, &mut pending, &mut metadata);

        let stop = json!({ "type": "message_stop" });
        match handle_event(&stop, &mut pending, &mut metadata) {
            EventOutcome::Stop => {}
            _ => panic!("expected stop"),
        }

        let payload = done_payload(pending, metadata);
        assert!(payload.done);
        let tool_calls = payload.tool_calls.unwrap();
        assert_eq!(tool_calls[0].name, "web_search");
        assert_eq!(tool_calls[0].arguments["query"], "x");
    }

    #[test]
    fn surfaces_anthropic_error_events() {
        let mut pending = BTreeMap::new();
        let mut metadata = empty_stream_metadata("claude-sonnet-4-20250514");

        let error = json!({
            "type": "error",
            "error": { "type": "overloaded_error", "message": "Overloaded" }
        });

        match handle_event(&error, &mut pending, &mut metadata) {
            EventOutcome::Error(message) => assert_eq!(message, "Overloaded"),
            _ => panic!("expected error outcome"),
        }
    }
}
