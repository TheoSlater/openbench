pub mod builtin;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

/// # Tool System
/// 
/// This module implements a dynamic tool registry that allows the LLM to call
/// Rust functions. It is designed to be extensible, supporting built-in tools,
/// and potentially external tools (Python/MCP) in the future.
/// 
/// Tools are defined via the `Tool` trait and registered in the `SharedToolRegistry`.

/// Core trait that all tools must implement.
/// The `#[derive(Tool)]` macro in `openbench-macros` provides a standard
/// implementation for these methods based on struct attributes.
#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    /// Unique identifier for the tool (e.g., "search_web").
    fn name(&self) -> String;
    /// Description of what the tool does, used by the LLM to decide when to call it.
    fn description(&self) -> String;
    /// JSON Schema describing the tool's input parameters.
    fn schema(&self) -> serde_json::Value;
    /// Whether this tool requires explicit user approval before execution.
    fn requires_approval(&self) -> bool;
    /// The actual execution logic. Takes raw JSON arguments and returns a Result.
    async fn execute(&self, args: serde_json::Value) -> Result<String, String>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Where the tool originated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ToolSource {
    Builtin,
}

/// MCP-compatible tool definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema for parameters (MCP `inputSchema`).
    pub parameters: serde_json::Value,
    pub source: ToolSource,
    /// If true, user must approve each invocation before execution.
    pub requires_approval: bool,
    /// If false, the tool is registered but not sent to the model.
    pub enabled: bool,
}

/// Result returned by a tool execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub success: bool,
    pub output: String,
    /// Wall-clock execution time in milliseconds.
    pub duration_ms: u64,
}

/// Emitted on the "tool-invocation" Tauri event when a tool fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationPayload {
    pub invocation_id: String,
    pub request_id: String,
    pub tool_name: String,
    pub tool_args: serde_json::Value,
    pub requires_approval: bool,
}

/// Response from the frontend for an approval request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalResponse {
    pub invocation_id: String,
    pub approved: bool,
    /// If true, skip approval for this tool in future calls this session.
    pub always_allow: bool,
}

// ---------------------------------------------------------------------------
// Registry (inner, not thread-safe on its own)
// ---------------------------------------------------------------------------

pub(crate) struct RegistryInner {
    tools: HashMap<String, ToolDefinition>,
    handlers: HashMap<String, Box<dyn Tool>>,
    always_allowed: HashSet<String>,
}

impl RegistryInner {
    fn new() -> Self {
        Self {
            tools: HashMap::new(),
            handlers: HashMap::new(),
            always_allowed: HashSet::new(),
        }
    }

    fn register(&mut self, tool: Box<dyn Tool>) {
        let definition = ToolDefinition {
            name: tool.name(),
            description: tool.description(),
            parameters: tool.schema(),
            source: ToolSource::Builtin,
            requires_approval: tool.requires_approval(),
            enabled: true,
        };
        self.handlers.insert(tool.name(), tool);
        self.tools.insert(definition.name.clone(), definition);
    }

    fn list_tools(&self) -> Vec<&ToolDefinition> {
        self.tools.values().collect()
    }

    fn list_enabled_tools(&self) -> Vec<&ToolDefinition> {
        self.tools.values().filter(|t| t.enabled).collect()
    }

    fn toggle_tool(&mut self, name: &str) -> Option<bool> {
        self.tools.get_mut(name).map(|t| {
            t.enabled = !t.enabled;
            t.enabled
        })
    }

    fn needs_approval(&self, name: &str) -> bool {
        if let Some(tool) = self.tools.get(name) {
            tool.requires_approval && !self.always_allowed.contains(name)
        } else {
            false
        }
    }

    async fn execute(&self, name: &str, args: serde_json::Value) -> ToolResult {
        let start = std::time::Instant::now();

        let handler = match self.handlers.get(name) {
            Some(h) => h,
            None => {
                return ToolResult {
                    success: false,
                    output: format!("Tool '{}' not found in registry", name),
                    duration_ms: 0,
                };
            }
        };

        if let Some(tool) = self.tools.get(name) {
            if !tool.enabled {
                return ToolResult {
                    success: false,
                    output: format!("Tool '{}' is disabled", name),
                    duration_ms: 0,
                };
            }
        }

        let (success, output) = match handler.execute(args).await {
            Ok(result) => (true, result),
            Err(e) => (false, e),
        };
        
        let duration_ms = start.elapsed().as_millis() as u64;

        ToolResult {
            success,
            output,
            duration_ms,
        }
    }

    /// Convert enabled tools to the Ollama-compatible JSON tool definitions.
    fn to_ollama_tool_json(&self) -> Vec<serde_json::Value> {
        self.list_enabled_tools()
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Thread-safe wrapper (goes into Tauri managed state)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SharedToolRegistry {
    inner: Arc<RwLock<RegistryInner>>,
}

impl SharedToolRegistry {
    /// Create a new registry with all built-in tools pre-registered.
    pub fn new() -> Self {
        let mut registry = RegistryInner::new();
        builtin::register_all(&mut registry);
        Self {
            inner: Arc::new(RwLock::new(registry)),
        }
    }

    /// Returns all registered tools, including disabled ones.
    pub async fn list_tools(&self) -> Vec<ToolDefinition> {
        self.inner.read().await.list_tools().into_iter().cloned().collect()
    }

    /// Returns only tools that are currently enabled.
    #[allow(dead_code)]
    pub async fn list_enabled_tools(&self) -> Vec<ToolDefinition> {
        self.inner.read().await.list_enabled_tools().into_iter().cloned().collect()
    }

    pub async fn toggle_tool(&self, name: &str) -> Option<bool> {
        self.inner.write().await.toggle_tool(name)
    }

    pub async fn needs_approval(&self, name: &str) -> bool {
        self.inner.read().await.needs_approval(name)
    }

    pub async fn set_always_allowed(&self, name: &str, allowed: bool) {
        let mut inner = self.inner.write().await;
        if allowed {
            inner.always_allowed.insert(name.to_string());
        } else {
            inner.always_allowed.remove(name);
        }
    }

    pub async fn execute(&self, name: &str, args: serde_json::Value) -> ToolResult {
        self.inner.read().await.execute(name, args).await
    }

    pub async fn to_ollama_tool_json(&self) -> Vec<serde_json::Value> {
        self.inner.read().await.to_ollama_tool_json()
    }
}
