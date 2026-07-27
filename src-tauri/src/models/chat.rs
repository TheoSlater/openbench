use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct StreamMetadata {
    pub prompt_eval_count: Option<u64>,
    pub eval_count: Option<u64>,
    pub total_duration: Option<u64>,
    pub load_duration: Option<u64>,
    pub prompt_eval_duration: Option<u64>,
    pub eval_duration: Option<u64>,
    pub model: String,
}

#[derive(Serialize, Clone)]
pub struct StreamPayload {
    pub request_id: String,
    pub content: String,
    pub thinking: Option<String>,
    pub done: bool,
    pub metadata: Option<StreamMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ThinkingPayload {
    pub request_id: String,
    pub thinking: String,
    pub is_thinking: bool,
}

#[derive(Serialize, Clone)]
pub struct PullProgressPayload {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct ModelDetails {
    pub name: String,
    pub families: Vec<String>,
    pub size: u64,
    pub provider_type: crate::providers::base::ProviderType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_config_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatAttachment {
    #[serde(rename = "type")]
    pub content_type: String,
    pub content: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    pub attachments: Option<Vec<ChatAttachment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCallInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct WebSearchEvent {
    pub request_id: String,
    pub query: String,
    pub status: String,
    pub results: Option<Vec<SearchResultItem>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub highlights: Vec<String>,
}
