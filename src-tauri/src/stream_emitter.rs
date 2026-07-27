use crate::models::chat::{StreamPayload, ThinkingPayload, WebSearchEvent};
use async_trait::async_trait;
use tauri::{AppHandle, Emitter};

#[async_trait]
pub trait StreamEmitter: Send + Sync {
    async fn emit_chunk(&self, payload: &StreamPayload);
    async fn emit_thinking(&self, payload: &ThinkingPayload);
    async fn emit_web_search(&self, payload: &WebSearchEvent);
}

pub struct TauriStreamEmitter {
    app_handle: AppHandle,
}

impl TauriStreamEmitter {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl StreamEmitter for TauriStreamEmitter {
    async fn emit_chunk(&self, payload: &StreamPayload) {
        let _ = self.app_handle.emit("chat-chunk", payload);
    }

    async fn emit_thinking(&self, payload: &ThinkingPayload) {
        let _ = self.app_handle.emit("chat-thinking", payload);
    }

    async fn emit_web_search(&self, payload: &WebSearchEvent) {
        let _ = self.app_handle.emit("web-search-event", payload);
    }
}

#[cfg(test)]
#[allow(dead_code)]
pub mod test {
    use super::*;
    use std::sync::Mutex;

    pub struct TestStreamEmitter {
        pub chunks: Mutex<Vec<StreamPayload>>,
        pub thinking: Mutex<Vec<ThinkingPayload>>,
        pub web_search: Mutex<Vec<WebSearchEvent>>,
    }

    impl TestStreamEmitter {
        pub fn new() -> Self {
            Self {
                chunks: Mutex::new(Vec::new()),
                thinking: Mutex::new(Vec::new()),
                web_search: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl StreamEmitter for TestStreamEmitter {
        async fn emit_chunk(&self, payload: &StreamPayload) {
            self.chunks.lock().unwrap().push(payload.clone());
        }

        async fn emit_thinking(&self, payload: &ThinkingPayload) {
            self.thinking.lock().unwrap().push(payload.clone());
        }

        async fn emit_web_search(&self, payload: &WebSearchEvent) {
            self.web_search.lock().unwrap().push(payload.clone());
        }
    }
}
