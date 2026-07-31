use super::base::{ChatProvider, ModelCatalog, ProviderConfig, ProviderType};
use super::factory::ProviderFactory;
use crate::connections::secrets::{Secret, SecretStore, REDACTED};
use crate::connections::{Connection, ConnectionModel, DiscoverySource, Provider};
use crate::error::AppError;
use crate::models::chat::{ChatMessage, StreamPayload, ThinkingPayload, WebSearchEvent};
use crate::stream_emitter::StreamEmitter;
use crate::tool_loop::{ToolLoop, ToolLoopResult};
use crate::web_search::{create_web_search_client, WebSearchConfig};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

const VALIDATION_TIMEOUT: Duration = Duration::from_secs(15);
const MODEL_TIMEOUT: Duration = Duration::from_secs(30);
const STREAM_TIMEOUT: Duration = Duration::from_secs(15 * 60);
pub const EVENT_QUEUE_CAPACITY: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ChatRuntimeStatus {
    Starting,
    Running,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatRuntimeError {
    pub code: String,
    pub message: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_duration_ms: Option<u64>,
}

/// Provider-neutral events. `metadata` is the only escape hatch for details
/// that cannot be normalized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export)]
pub enum ChatRuntimeEvent {
    #[serde(rename = "message.delta")]
    MessageDelta { request_id: String, delta: String },
    #[serde(rename = "reasoning.delta")]
    ReasoningDelta { request_id: String, delta: String },
    #[serde(rename = "tool.started")]
    ToolStarted {
        request_id: String,
        tool_call_id: String,
        name: String,
        #[ts(type = "unknown")]
        input: Value,
    },
    #[serde(rename = "tool.updated")]
    ToolUpdated {
        request_id: String,
        tool_call_id: String,
        #[ts(type = "unknown | null")]
        metadata: Option<Value>,
    },
    #[serde(rename = "tool.completed")]
    ToolCompleted {
        request_id: String,
        tool_call_id: String,
        #[ts(type = "unknown | null")]
        output: Option<Value>,
        error: Option<String>,
    },
    #[serde(rename = "usage.updated")]
    UsageUpdated {
        request_id: String,
        usage: ChatUsage,
        #[ts(type = "unknown | null")]
        metadata: Option<Value>,
    },
    #[serde(rename = "status.changed")]
    StatusChanged {
        request_id: String,
        status: ChatRuntimeStatus,
    },
    #[serde(rename = "completed")]
    Completed {
        request_id: String,
        #[ts(type = "unknown | null")]
        metadata: Option<Value>,
    },
    #[serde(rename = "failed")]
    Failed {
        request_id: String,
        error: ChatRuntimeError,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectionValidation {
    pub ready: bool,
    pub message: String,
}

#[derive(Clone)]
pub struct ChatEventSink {
    sender: mpsc::Sender<ChatRuntimeEvent>,
}

impl ChatEventSink {
    #[must_use]
    pub fn channel() -> (Self, mpsc::Receiver<ChatRuntimeEvent>) {
        let (sender, receiver) = mpsc::channel(EVENT_QUEUE_CAPACITY);
        (Self { sender }, receiver)
    }

    /// A full queue backpressures the provider. Cancellation always wins, so a
    /// slow renderer cannot pin a network request after the user stops it.
    pub async fn send(
        &self,
        event: ChatRuntimeEvent,
        cancellation: &CancellationToken,
    ) -> Result<(), AppError> {
        tokio::select! {
            _ = cancellation.cancelled() => Err(AppError::Cancelled),
            result = self.sender.send(event) => result.map_err(|_| AppError::Cancelled),
        }
    }

    async fn send_terminal(&self, event: ChatRuntimeEvent) {
        let _ = self.sender.send(event).await;
    }
}

pub struct AdapterChatRequest {
    pub request_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub system_prompt: Option<String>,
    pub reasoning_enabled: bool,
    pub web_search: Option<WebSearchConfig>,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    async fn validate(&self) -> Result<ConnectionValidation, ChatRuntimeError>;
    async fn list_models(&self) -> Result<Vec<ConnectionModel>, ChatRuntimeError>;
    async fn stream_chat(
        &self,
        request: AdapterChatRequest,
        cancellation: CancellationToken,
        events: ChatEventSink,
    ) -> Result<ToolLoopResult, ChatRuntimeError>;
    fn chat_provider(&self) -> &dyn ChatProvider;
}

pub struct ConnectionProviderAdapter {
    connection: Connection,
    chat: Box<dyn ChatProvider>,
    catalog: Box<dyn ModelCatalog>,
    redactions: Vec<String>,
}

impl ConnectionProviderAdapter {
    pub fn new(
        connection: Connection,
        secret_store: &dyn SecretStore,
    ) -> Result<Self, ChatRuntimeError> {
        if !connection.enabled {
            return Err(runtime_error(
                "connection-disabled",
                "This connection is disabled.",
                Some("Enable it in Connections, then try again."),
            ));
        }

        let secret = match &connection.secret_ref {
            Some(reference) => Some(secret_store.get(reference).map_err(|error| {
                runtime_error(
                    "credential-unavailable",
                    &format!("Could not load this connection's credential: {error}"),
                    Some("Re-enter the API key in Connections."),
                )
            })?),
            None if connection.provider.needs_credential() => {
                return Err(runtime_error(
                    "credential-required",
                    "This connection needs an API key.",
                    Some("Add an API key in Connections."),
                ));
            }
            None => None,
        };

        let config = legacy_config(&connection, secret.as_ref());
        let chat = ProviderFactory::create_chat_provider(config.clone()).ok_or_else(|| {
            runtime_error(
                "connection-unavailable",
                "The provider could not be initialized.",
                Some("Check the endpoint and enabled state."),
            )
        })?;
        let catalog = ProviderFactory::create_model_catalog(config).ok_or_else(|| {
            runtime_error(
                "connection-unavailable",
                "The model catalog could not be initialized.",
                Some("Check the endpoint and enabled state."),
            )
        })?;

        let mut redactions = secret
            .as_ref()
            .map(|secret| vec![secret.expose().to_string()])
            .unwrap_or_default();
        redactions.extend(header_values(connection.extra_headers.as_deref()));

        Ok(Self {
            connection,
            chat,
            catalog,
            redactions,
        })
    }

    fn error(&self, code: &str, message: impl Into<String>) -> ChatRuntimeError {
        let message = redact_error(&message.into(), &self.redactions);
        runtime_error(
            code,
            &message,
            Some("Check the API key and base URL, then try again."),
        )
    }
}

#[async_trait]
impl ProviderAdapter for ConnectionProviderAdapter {
    async fn validate(&self) -> Result<ConnectionValidation, ChatRuntimeError> {
        let models = tokio::time::timeout(VALIDATION_TIMEOUT, self.catalog.get_available_models())
            .await
            .map_err(|_| {
                self.error(
                    "validation-timeout",
                    "Connection validation timed out before the provider responded.",
                )
            })?
            .map_err(|error| self.error("validation-failed", error))?;

        Ok(ConnectionValidation {
            ready: true,
            message: format!("Connected. {} model(s) available.", models.len()),
        })
    }

    async fn list_models(&self) -> Result<Vec<ConnectionModel>, ChatRuntimeError> {
        let models = tokio::time::timeout(MODEL_TIMEOUT, self.catalog.get_available_models())
            .await
            .map_err(|_| self.error("model-list-timeout", "Model discovery timed out."))?
            .map_err(|error| self.error("model-list-failed", error))?;
        Ok(models
            .into_iter()
            .map(|model| ConnectionModel {
                connection_id: self.connection.id.clone(),
                remote_id: model.name.clone(),
                display_name: Some(model.name),
                capabilities: Some(json!({ "families": model.families }).to_string()),
                enabled: true,
                aliases: Vec::new(),
                metadata: (model.size > 0).then(|| json!({ "size": model.size }).to_string()),
                discovery_source: DiscoverySource::Remote,
                last_seen_at: Some(chrono::Utc::now().to_rfc3339()),
            })
            .collect())
    }

    async fn stream_chat(
        &self,
        request: AdapterChatRequest,
        cancellation: CancellationToken,
        events: ChatEventSink,
    ) -> Result<ToolLoopResult, ChatRuntimeError> {
        let emitter = NormalizedEmitter::new(events.clone(), cancellation.clone());
        events
            .send(
                ChatRuntimeEvent::StatusChanged {
                    request_id: request.request_id.clone(),
                    status: ChatRuntimeStatus::Running,
                },
                &cancellation,
            )
            .await
            .map_err(|_| self.error("cancelled", "Request cancelled."))?;

        let web_client = request.web_search.as_ref().map(create_web_search_client);
        let web_search = web_client.as_deref().zip(request.web_search.as_ref());
        let result = tokio::time::timeout(
            STREAM_TIMEOUT,
            ToolLoop::run(
                self.chat.as_ref(),
                &request.model,
                request.messages,
                request.system_prompt,
                request.reasoning_enabled,
                &request.request_id,
                &emitter,
                web_search,
                cancellation.clone(),
            ),
        )
        .await;

        match result {
            Err(_) => {
                cancellation.cancel();
                let error = self.error("stream-timeout", "The chat request timed out.");
                events
                    .send_terminal(ChatRuntimeEvent::Failed {
                        request_id: request.request_id,
                        error: error.clone(),
                    })
                    .await;
                Err(error)
            }
            Ok(Err(AppError::Cancelled)) => {
                events
                    .send_terminal(ChatRuntimeEvent::StatusChanged {
                        request_id: request.request_id,
                        status: ChatRuntimeStatus::Cancelled,
                    })
                    .await;
                Err(self.error("cancelled", "Request cancelled."))
            }
            Ok(Err(error)) => {
                let error = self.error("stream-failed", error.to_string());
                events
                    .send_terminal(ChatRuntimeEvent::Failed {
                        request_id: request.request_id,
                        error: error.clone(),
                    })
                    .await;
                Err(error)
            }
            Ok(Ok(result)) => Ok(result),
        }
    }

    fn chat_provider(&self) -> &dyn ChatProvider {
        self.chat.as_ref()
    }
}

fn legacy_config(connection: &Connection, secret: Option<&Secret>) -> ProviderConfig {
    let key = secret.map(|secret| secret.expose().to_string());
    let provider_type = match connection.provider {
        Provider::Anthropic => ProviderType::AnthropicNative,
        Provider::Gemini => ProviderType::GeminiNative,
        Provider::Ollama => ProviderType::OllamaLocal,
        Provider::Openai
        | Provider::Openrouter
        | Provider::Lmstudio
        | Provider::OpenaiCompatible
        | Provider::VercelGateway => ProviderType::OpenAICompatible,
    };
    ProviderConfig {
        id: 0,
        account_id: connection.account_id.clone(),
        provider_type,
        enabled: true,
        ollama_host: (provider_type == ProviderType::OllamaLocal)
            .then(|| connection.effective_base_url().to_string()),
        ollama_api_key: (provider_type == ProviderType::OllamaLocal)
            .then(|| key.clone())
            .flatten(),
        ollama_api_base_url: (provider_type == ProviderType::OllamaLocal)
            .then(|| connection.effective_base_url().to_string()),
        api_key: (provider_type != ProviderType::OllamaLocal)
            .then(|| key.clone())
            .flatten(),
        api_base_url: (provider_type != ProviderType::OllamaLocal)
            .then(|| connection.effective_base_url().to_string()),
        priority: connection.position,
        preset: None,
        headers: connection.extra_headers.clone(),
        model_suggestions: None,
    }
}

fn header_values(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|raw| serde_json::from_str::<HashMap<String, String>>(raw).ok())
        .map(|headers| headers.into_values().collect())
        .unwrap_or_default()
}

fn redact_error(message: &str, redactions: &[String]) -> String {
    redactions
        .iter()
        .filter(|value| !value.is_empty())
        .fold(message.to_string(), |message, value| {
            message.replace(value, REDACTED)
        })
}

fn runtime_error(code: &str, message: &str, action: Option<&str>) -> ChatRuntimeError {
    ChatRuntimeError {
        code: code.into(),
        message: message.into(),
        action: action.map(str::to_string),
    }
}

struct NormalizedEmitter {
    sink: ChatEventSink,
    cancellation: CancellationToken,
    thinking: AsyncMutex<String>,
}

impl NormalizedEmitter {
    fn new(sink: ChatEventSink, cancellation: CancellationToken) -> Self {
        Self {
            sink,
            cancellation,
            thinking: AsyncMutex::new(String::new()),
        }
    }

    async fn emit(&self, event: ChatRuntimeEvent) {
        let _ = self.sink.send(event, &self.cancellation).await;
    }
}

#[async_trait]
impl StreamEmitter for NormalizedEmitter {
    async fn emit_chunk(&self, payload: &StreamPayload) {
        if payload.error.is_some() {
            // ToolLoop returns the same error; `stream_chat` emits the single
            // terminal `failed` event so listeners never settle twice.
            return;
        }
        if !payload.content.is_empty() {
            self.emit(ChatRuntimeEvent::MessageDelta {
                request_id: payload.request_id.clone(),
                delta: payload.content.clone(),
            })
            .await;
        }
        if let Some(metadata) = &payload.metadata {
            self.emit(ChatRuntimeEvent::UsageUpdated {
                request_id: payload.request_id.clone(),
                usage: ChatUsage {
                    input_tokens: metadata.prompt_eval_count,
                    output_tokens: metadata.eval_count,
                    total_duration_ms: metadata.total_duration.map(|value| value / 1_000_000),
                },
                metadata: Some(json!({ "model": metadata.model })),
            })
            .await;
        }
        if payload.done {
            self.emit(ChatRuntimeEvent::Completed {
                request_id: payload.request_id.clone(),
                metadata: None,
            })
            .await;
        }
    }

    async fn emit_thinking(&self, payload: &ThinkingPayload) {
        let mut previous = self.thinking.lock().await;
        let delta = payload
            .thinking
            .strip_prefix(previous.as_str())
            .unwrap_or(&payload.thinking)
            .to_string();
        *previous = payload.thinking.clone();
        if !delta.is_empty() {
            self.emit(ChatRuntimeEvent::ReasoningDelta {
                request_id: payload.request_id.clone(),
                delta,
            })
            .await;
        }
    }

    async fn emit_web_search(&self, payload: &WebSearchEvent) {
        let id = format!("web-search:{}", payload.query);
        match payload.status.as_str() {
            "searching" => {
                self.emit(ChatRuntimeEvent::ToolStarted {
                    request_id: payload.request_id.clone(),
                    tool_call_id: id,
                    name: "web_search".into(),
                    input: json!({ "query": payload.query }),
                })
                .await;
            }
            "complete" => {
                self.emit(ChatRuntimeEvent::ToolCompleted {
                    request_id: payload.request_id.clone(),
                    tool_call_id: id,
                    output: payload.results.as_ref().map(|results| json!(results)),
                    error: None,
                })
                .await;
            }
            _ => {
                self.emit(ChatRuntimeEvent::ToolCompleted {
                    request_id: payload.request_id.clone(),
                    tool_call_id: id,
                    output: payload.results.as_ref().map(|results| json!(results)),
                    error: Some("Web search failed.".into()),
                })
                .await;
            }
        }
    }
}

/// Per-request cancellation. No shared generation counter: stopping one model
/// cannot cancel sibling streams in the same conversation.
#[derive(Default)]
pub struct ChatRequestRegistry {
    requests: Mutex<HashMap<String, CancellationToken>>,
}

impl ChatRequestRegistry {
    pub fn register(&self, request_id: &str) -> Result<CancellationToken, String> {
        let mut requests = self.requests.lock().expect("chat request registry");
        if requests.contains_key(request_id) {
            return Err(format!("request {request_id} is already running"));
        }
        let token = CancellationToken::new();
        requests.insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    pub fn finish(&self, request_id: &str) {
        self.requests
            .lock()
            .expect("chat request registry")
            .remove(request_id);
    }

    pub fn cancel(&self, request_id: Option<&str>) {
        let requests = self.requests.lock().expect("chat request registry");
        match request_id {
            Some(request_id) => {
                if let Some(token) = requests.get(request_id) {
                    token.cancel();
                }
            }
            None => requests.values().for_each(CancellationToken::cancel),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::secrets::{InMemorySecretStore, SecretRef};
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn one_response(status: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let body = body.to_string();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let _ = socket.read(&mut request).await;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        format!("http://{address}")
    }

    fn connection(provider: Provider, base_url: String) -> Connection {
        Connection {
            id: format!("connection-{}", provider.as_str()),
            account_id: "account".into(),
            provider,
            display_name: provider.as_str().into(),
            enabled: true,
            base_url: Some(base_url),
            secret_ref: Some(SecretRef::for_connection("test")),
            extra_headers: None,
            position: 0,
        }
    }

    #[test]
    fn errors_redact_keys_and_custom_header_values() {
        let message = redact_error(
            "request https://example.test?key=sk-secret with Bearer hidden-value failed",
            &["sk-secret".into(), "hidden-value".into()],
        );
        assert!(!message.contains("sk-secret"));
        assert!(!message.contains("hidden-value"));
        assert_eq!(message.matches(REDACTED).count(), 2);
    }

    #[tokio::test]
    async fn cancelled_bounded_sink_releases_a_blocked_sender() {
        let (sink, _receiver) = ChatEventSink::channel();
        let cancellation = CancellationToken::new();
        for index in 0..EVENT_QUEUE_CAPACITY {
            sink.send(
                ChatRuntimeEvent::MessageDelta {
                    request_id: "request".into(),
                    delta: index.to_string(),
                },
                &cancellation,
            )
            .await
            .unwrap();
        }
        let blocked = sink.send(
            ChatRuntimeEvent::MessageDelta {
                request_id: "request".into(),
                delta: "blocked".into(),
            },
            &cancellation,
        );
        tokio::pin!(blocked);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), &mut blocked)
                .await
                .is_err()
        );
        cancellation.cancel();
        assert!(matches!(blocked.await, Err(AppError::Cancelled)));
    }

    #[test]
    fn runtime_event_uses_protocol_names() {
        let value = serde_json::to_value(ChatRuntimeEvent::MessageDelta {
            request_id: "r".into(),
            delta: "hi".into(),
        })
        .unwrap();
        assert_eq!(value["type"], "message.delta");
        assert_eq!(value["delta"], "hi");
    }

    #[test]
    fn request_registry_cancels_only_the_selected_request() {
        let registry = ChatRequestRegistry::default();
        let first = registry.register("first").unwrap();
        let second = registry.register("second").unwrap();
        registry.cancel(Some("first"));
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        registry.finish("first");
        assert!(registry.register("first").is_ok());
    }

    #[tokio::test]
    async fn validation_succeeds_for_every_provider_shape() {
        let cases = [
            (Provider::Openai, r#"{"data":[]}"#),
            (Provider::Anthropic, r#"{"data":[]}"#),
            (Provider::Gemini, r#"{"models":[]}"#),
            (Provider::Openrouter, r#"{"data":[]}"#),
            (Provider::Ollama, r#"{"models":[]}"#),
            (Provider::Lmstudio, r#"{"data":[]}"#),
            (Provider::OpenaiCompatible, r#"{"data":[]}"#),
        ];
        for (provider, body) in cases {
            let store = InMemorySecretStore::new();
            store
                .set(&SecretRef::for_connection("test"), &Secret::new("sk-test"))
                .unwrap();
            let adapter = ConnectionProviderAdapter::new(
                connection(provider, one_response("200 OK", body).await),
                &store,
            )
            .unwrap();
            assert!(adapter.validate().await.unwrap().ready, "{provider:?}");
        }
    }

    #[tokio::test]
    async fn validation_failures_are_actionable_and_redacted() {
        for provider in [
            Provider::Openai,
            Provider::Anthropic,
            Provider::Gemini,
            Provider::Openrouter,
            Provider::Ollama,
            Provider::Lmstudio,
            Provider::OpenaiCompatible,
        ] {
            let store = InMemorySecretStore::new();
            store
                .set(
                    &SecretRef::for_connection("test"),
                    &Secret::new("sk-never-log"),
                )
                .unwrap();
            let adapter = ConnectionProviderAdapter::new(
                connection(
                    provider,
                    one_response(
                        "401 Unauthorized",
                        r#"{"error":{"message":"bad sk-never-log"}}"#,
                    )
                    .await,
                ),
                &store,
            )
            .unwrap();
            let error = adapter.validate().await.unwrap_err();
            assert!(error.action.is_some(), "{provider:?}: {error:?}");
            assert!(!error.message.contains("sk-never-log"));
        }
    }

    #[tokio::test]
    async fn unexpected_model_shape_is_an_actionable_error() {
        let store = InMemorySecretStore::new();
        store
            .set(&SecretRef::for_connection("test"), &Secret::new("sk-test"))
            .unwrap();
        let adapter = ConnectionProviderAdapter::new(
            connection(
                Provider::Openai,
                one_response("200 OK", r#"{"data":[{"unexpected":true}]}"#).await,
            ),
            &store,
        )
        .unwrap();
        let error = adapter.list_models().await.unwrap_err();
        assert_eq!(error.code, "model-list-failed");
        assert!(error.action.is_some());
    }

    struct PendingProvider {
        dropped: Arc<AtomicBool>,
    }

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl ChatProvider for PendingProvider {
        async fn chat_completion(
            &self,
            _model: String,
            _messages: Vec<ChatMessage>,
            _system_prompt: Option<String>,
            _options: Option<Value>,
            _tools: Option<Vec<crate::models::chat::ToolDefinition>>,
        ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamPayload, String>> + Send>>, String>
        {
            let guard = DropFlag(self.dropped.clone());
            Ok(Box::pin(futures::stream::poll_fn(move |_| {
                let _ = &guard;
                std::task::Poll::Pending
            })))
        }

        fn get_provider_name(&self) -> String {
            "pending".into()
        }
    }

    #[tokio::test]
    async fn cancellation_drops_an_in_flight_provider_stream() {
        let dropped = Arc::new(AtomicBool::new(false));
        let provider = PendingProvider {
            dropped: dropped.clone(),
        };
        let cancellation = CancellationToken::new();
        let cancel = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancel.cancel();
        });
        let (sink, _receiver) = ChatEventSink::channel();
        let emitter = NormalizedEmitter::new(sink, cancellation.clone());
        let result = ToolLoop::run(
            &provider,
            "model",
            vec![],
            None,
            false,
            "request",
            &emitter,
            None,
            cancellation,
        )
        .await;
        assert!(matches!(result, Err(AppError::Cancelled)));
        assert!(dropped.load(Ordering::SeqCst));
    }
}
