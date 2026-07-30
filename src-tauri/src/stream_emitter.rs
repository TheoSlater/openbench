use crate::models::chat::{StreamPayload, ThinkingPayload, WebSearchEvent};
use async_trait::async_trait;

#[async_trait]
pub trait StreamEmitter: Send + Sync {
    async fn emit_chunk(&self, payload: &StreamPayload);
    async fn emit_thinking(&self, payload: &ThinkingPayload);
    async fn emit_web_search(&self, payload: &WebSearchEvent);
}
