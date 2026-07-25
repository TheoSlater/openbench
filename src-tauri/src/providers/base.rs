use crate::models::chat::ToolDefinition;
use crate::models::chat::{ChatMessage, ModelDetails, PullProgressPayload, StreamPayload};
use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, sqlx::Type)]
pub enum ProviderType {
    OllamaLocal,
    OpenAICompatible,
    // TODO: Add native Anthropic provider.
    // Implements ChatProvider + ModelCatalog.
    // Uses https://api.anthropic.com/v1/messages endpoint.
    // SSE format: message_start → content_block_delta → message_delta → message_stop.
    // System prompt goes as top-level "system" param (not in messages).
    // Tools use top-level "tools[]" with "input_schema" (no function wrapper).
    // Thinking mode via "thinking" content block type + extended thinking header.
    AnthropicNative,
    GeminiNative,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProviderStatus {
    Online,
    Offline,
    Reconnecting,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProviderConfig {
    pub id: i64,
    pub account_id: String,
    pub provider_type: ProviderType,
    pub enabled: bool,
    pub ollama_host: Option<String>,
    pub ollama_api_key: Option<String>,
    pub ollama_api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
    pub priority: i32,
    pub preset: Option<String>,
    pub headers: Option<String>,
    pub model_suggestions: Option<String>,
}

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn health_check(&self) -> ProviderStatus;
    async fn chat_completion(
        &self,
        model: String,
        messages: Vec<ChatMessage>,
        system_prompt: Option<String>,
        options: Option<serde_json::Value>,
        tools: Option<Vec<ToolDefinition>>,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamPayload, String>> + Send>>, String>;
    fn get_provider_name(&self) -> String;
    fn get_provider_type(&self) -> ProviderType;
}

#[async_trait]
pub trait ModelCatalog: Send + Sync {
    async fn get_available_models(&self) -> Result<Vec<ModelDetails>, String>;
    fn get_provider_type(&self) -> ProviderType;
}

#[async_trait]
pub trait LocalModelManager: ModelCatalog {
    async fn pull_model(
        &self,
        model: String,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<PullProgressPayload, String>> + Send>>, String>;
    async fn delete_model(&self, model: String) -> Result<(), String>;
}
