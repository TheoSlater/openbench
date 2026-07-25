use crate::models::chat::{
    ChatMessage, ModelDetails, StreamMetadata, StreamPayload, ToolCallInfo, ToolDefinition,
};
use crate::providers::base::{ChatProvider, ModelCatalog, ProviderStatus, ProviderType};
use crate::providers::openai_compatible::SseParser;
use async_stream::stream;
use async_trait::async_trait;
use futures::Stream;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::pin::Pin;
use tokio_stream::StreamExt;

pub struct GeminiNativeProvider {
    client: Client,
    base_url: String,
    api_key: String,
}

impl GeminiNativeProvider {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: normalize_base_url(&base_url),
            api_key: api_key.unwrap_or_default(),
        }
    }
}

#[async_trait]
impl ChatProvider for GeminiNativeProvider {
    async fn health_check(&self) -> ProviderStatus {
        let request = self
            .client
            .get(format!("{}/models", self.base_url))
            .query(&[("key", &self.api_key)]);
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
        let body = build_request_body(messages, system_prompt, options, tools);
        let request = self
            .client
            .post(format!("{}/models/{model}:streamGenerateContent", self.base_url))
            .query(&[("alt", "sse"), ("key", &self.api_key)])
            .json(&body);
        let response = request.send().await.map_err(normalize_network_error)?;

        if !response.status().is_success() {
            return Err(api_error(response).await);
        }

        let mut bytes = response.bytes_stream();
        let stream_model = model.clone();
        let output = stream! {
            let mut parser = SseParser::default();
            let mut tool_calls = Vec::<ToolCallInfo>::new();
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
                    match parse_event(&event, &mut tool_calls, &mut metadata) {
                        Ok(payloads) => {
                            for payload in payloads {
                                yield Ok(payload);
                            }
                        }
                        Err(error) => {
                            yield Err(error);
                            return;
                        }
                    }
                }
            }

            for event in parser.finish() {
                match parse_event(&event, &mut tool_calls, &mut metadata) {
                    Ok(payloads) => {
                        for payload in payloads {
                            yield Ok(payload);
                        }
                    }
                    Err(error) => {
                        yield Err(error);
                        return;
                    }
                }
            }

            yield Ok(done_payload(tool_calls, metadata));
        };

        Ok(Box::pin(output))
    }

    fn get_provider_name(&self) -> String {
        "Gemini".to_string()
    }

    fn get_provider_type(&self) -> ProviderType {
        ProviderType::GeminiNative
    }
}

#[async_trait]
impl ModelCatalog for GeminiNativeProvider {
    async fn get_available_models(&self) -> Result<Vec<ModelDetails>, String> {
        let request = self
            .client
            .get(format!("{}/models", self.base_url))
            .query(&[("key", &self.api_key)]);
        let response = request.send().await.map_err(normalize_network_error)?;

        if !response.status().is_success() {
            return Err(api_error(response).await);
        }

        let body: ModelsResponse = response
            .json()
            .await
            .map_err(|error| format!("Gemini API response parse failed: {error}"))?;

        Ok(body
            .models
            .into_iter()
            .filter(|model| {
                model
                    .supported_generation_methods
                    .iter()
                    .any(|method| method == "generateContent")
            })
            .map(|model| ModelDetails {
                name: model
                    .name
                    .strip_prefix("models/")
                    .unwrap_or(&model.name)
                    .to_string(),
                families: vec!["gemini".to_string()],
                size: 0,
                provider_type: ProviderType::GeminiNative,
                provider_config_id: None,
            })
            .collect())
    }

    fn get_provider_type(&self) -> ProviderType {
        ProviderType::GeminiNative
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
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    options: Option<Value>,
    tools: Option<Vec<ToolDefinition>>,
) -> Value {
    let mut body = Map::from_iter([(
        "contents".to_string(),
        Value::Array(build_contents(messages)),
    )]);

    if let Some(prompt) = system_prompt.filter(|prompt| !prompt.trim().is_empty()) {
        body.insert(
            "systemInstruction".to_string(),
            json!({ "parts": [{ "text": prompt }] }),
        );
    }

    if let Some(tools) = tools.filter(|tools| !tools.is_empty()) {
        body.insert(
            "tools".to_string(),
            json!([{ "functionDeclarations": tools.into_iter().map(tool_declaration_value).collect::<Vec<_>>() }]),
        );
    }

    let generation_config = generation_config_value(options);
    if !generation_config.is_empty() {
        body.insert("generationConfig".to_string(), Value::Object(generation_config));
    }

    Value::Object(body)
}

fn generation_config_value(options: Option<Value>) -> Map<String, Value> {
    let mut config = Map::new();
    let Some(options) = options.and_then(|value| value.as_object().cloned()) else {
        return config;
    };
    if let Some(temperature) = options.get("temperature") {
        config.insert("temperature".to_string(), temperature.clone());
    }
    if let Some(max_tokens) = options.get("max_tokens") {
        config.insert("maxOutputTokens".to_string(), max_tokens.clone());
    }
    config
}

fn tool_declaration_value(tool: ToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
    })
}

fn build_contents(messages: Vec<ChatMessage>) -> Vec<Value> {
    let mut output = Vec::new();
    let mut id_to_name: BTreeMap<String, String> = BTreeMap::new();
    for message in messages {
        let value = match message.role.as_str() {
            "assistant" => assistant_content_value(message, &mut id_to_name),
            "tool" => tool_result_content_value(message, &id_to_name),
            _ => user_content_value(message),
        };
        output.push(value);
    }
    output
}

fn assistant_content_value(message: ChatMessage, id_to_name: &mut BTreeMap<String, String>) -> Value {
    let mut parts = Vec::new();
    if !message.content.is_empty() {
        parts.push(json!({ "text": message.content }));
    }
    for call in message.tool_calls.into_iter().flatten() {
        if let Some(id) = &call.id {
            id_to_name.insert(id.clone(), call.name.clone());
        }
        parts.push(json!({ "functionCall": { "name": call.name, "args": call.arguments } }));
    }
    json!({ "role": "model", "parts": parts })
}

fn tool_result_content_value(message: ChatMessage, id_to_name: &BTreeMap<String, String>) -> Value {
    let name = message
        .tool_call_id
        .as_ref()
        .and_then(|id| id_to_name.get(id))
        .cloned()
        .unwrap_or_default();
    json!({
        "role": "user",
        "parts": [{
            "functionResponse": {
                "name": name,
                "response": { "content": message.content },
            }
        }]
    })
}

fn user_content_value(message: ChatMessage) -> Value {
    let mut parts = vec![json!({ "text": message.content })];
    parts.extend(
        message
            .attachments
            .unwrap_or_default()
            .into_iter()
            .filter(|attachment| attachment.content_type.starts_with("image/"))
            .filter_map(|attachment| {
                attachment.content.map(|data| {
                    json!({
                        "inlineData": {
                            "mimeType": attachment.content_type,
                            "data": data,
                        }
                    })
                })
            }),
    );
    json!({ "role": "user", "parts": parts })
}

fn parse_event(
    event: &str,
    tool_calls: &mut Vec<ToolCallInfo>,
    metadata: &mut StreamMetadata,
) -> Result<Vec<StreamPayload>, String> {
    let value: Value = serde_json::from_str(event)
        .map_err(|error| format!("Gemini stream parse failed: {error}"))?;

    if let Some(message) = value
        .pointer("/error/message")
        .and_then(Value::as_str)
    {
        return Err(message.to_string());
    }

    if let Some(prompt_tokens) = value
        .pointer("/usageMetadata/promptTokenCount")
        .and_then(Value::as_u64)
    {
        metadata.prompt_eval_count = Some(prompt_tokens);
    }
    if let Some(output_tokens) = value
        .pointer("/usageMetadata/candidatesTokenCount")
        .and_then(Value::as_u64)
    {
        metadata.eval_count = Some(output_tokens);
    }

    let mut payloads = Vec::new();
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array);
    for part in parts.into_iter().flatten() {
        if let Some(function_call) = part.get("functionCall") {
            let name = function_call
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let arguments = function_call
                .get("args")
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            tool_calls.push(ToolCallInfo {
                id: Some(format!("call_{}", uuid::Uuid::new_v4())),
                name,
                arguments,
            });
            continue;
        }

        let Some(text) = part.get("text").and_then(Value::as_str) else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        let is_thought = part.get("thought").and_then(Value::as_bool).unwrap_or(false);
        payloads.push(if is_thought {
            thinking_payload(text.to_string())
        } else {
            text_payload(text.to_string())
        });
    }

    Ok(payloads)
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

fn done_payload(tool_calls: Vec<ToolCallInfo>, metadata: StreamMetadata) -> StreamPayload {
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
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| body.trim().to_string());
    if message.is_empty() {
        format!("Gemini API error ({status})")
    } else {
        format!("Gemini API error ({status}): {message}")
    }
}

fn normalize_network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Gemini API request timed out.".to_string()
    } else {
        format!("Network error reaching Gemini API: {error}")
    }
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    models: Vec<GeminiModel>,
}

#[derive(Deserialize)]
struct GeminiModel {
    name: String,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_generation_methods: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::chat::ChatMessage;

    #[test]
    fn normalizes_base_url() {
        assert_eq!(
            normalize_base_url("https://generativelanguage.googleapis.com/v1beta/"),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            normalize_base_url("generativelanguage.googleapis.com/v1beta"),
            "https://generativelanguage.googleapis.com/v1beta"
        );
    }

    #[test]
    fn moves_system_prompt_to_system_instruction() {
        let body = build_request_body(
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

        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Be helpful");
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][0]["parts"][0]["text"], "Hello");
    }

    #[test]
    fn converts_tools_to_function_declarations() {
        let body = build_request_body(
            Vec::new(),
            None,
            None,
            Some(vec![ToolDefinition {
                name: "web_search".into(),
                description: "search the web".into(),
                parameters: json!({ "type": "object", "properties": {} }),
            }]),
        );

        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["name"],
            "web_search"
        );
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["parameters"]["type"],
            "object"
        );
    }

    #[test]
    fn maps_max_tokens_option_to_generation_config() {
        let body = build_request_body(Vec::new(), None, Some(json!({ "max_tokens": 512 })), None);
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 512);
    }

    #[test]
    fn resolves_tool_result_function_name_from_prior_call_id() {
        let messages = vec![
            ChatMessage {
                role: "assistant".into(),
                content: String::new(),
                attachments: None,
                tool_calls: Some(vec![ToolCallInfo {
                    id: Some("call_123".into()),
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
                tool_call_id: Some("call_123".into()),
            },
        ];

        let contents = build_contents(messages);

        assert_eq!(contents[0]["parts"][0]["functionCall"]["name"], "web_search");
        assert_eq!(contents[1]["role"], "user");
        assert_eq!(
            contents[1]["parts"][0]["functionResponse"]["name"],
            "web_search"
        );
        assert_eq!(
            contents[1]["parts"][0]["functionResponse"]["response"]["content"],
            "result text"
        );
    }

    #[test]
    fn parses_text_and_function_call_parts_from_candidate_events() {
        let mut tool_calls = Vec::new();
        let mut metadata = empty_stream_metadata("gemini-2.5-flash");

        let text_event = json!({
            "candidates": [{ "content": { "parts": [{ "text": "Hi" }], "role": "model" } }]
        })
        .to_string();
        let payloads = parse_event(&text_event, &mut tool_calls, &mut metadata).unwrap();
        assert_eq!(payloads[0].content, "Hi");

        let call_event = json!({
            "candidates": [{
                "content": {
                    "parts": [{ "functionCall": { "name": "web_search", "args": { "query": "x" } } }],
                    "role": "model"
                }
            }],
            "usageMetadata": { "promptTokenCount": 10, "candidatesTokenCount": 5 }
        })
        .to_string();
        let payloads = parse_event(&call_event, &mut tool_calls, &mut metadata).unwrap();
        assert!(payloads.is_empty());
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].name, "web_search");
        assert_eq!(tool_calls[0].arguments["query"], "x");
        assert_eq!(metadata.prompt_eval_count, Some(10));
        assert_eq!(metadata.eval_count, Some(5));
    }

    #[test]
    fn surfaces_gemini_error_events() {
        let mut tool_calls = Vec::new();
        let mut metadata = empty_stream_metadata("gemini-2.5-flash");
        let error_event = json!({ "error": { "code": 429, "message": "Rate limited" } }).to_string();

        match parse_event(&error_event, &mut tool_calls, &mut metadata) {
            Err(message) => assert_eq!(message, "Rate limited"),
            Ok(_) => panic!("expected error"),
        }
    }
}
