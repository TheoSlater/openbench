use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::{Display, Formatter, Result as FmtResult};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScope {
    User,
    Project,
    Chat,
}

impl MemoryScope {
    pub fn as_str(self) -> &'static str {
        match self {
            MemoryScope::User => "user",
            MemoryScope::Project => "project",
            MemoryScope::Chat => "chat",
        }
    }
}

impl Display for MemoryScope {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for MemoryScope {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "user" => Ok(MemoryScope::User),
            "project" => Ok(MemoryScope::Project),
            "chat" => Ok(MemoryScope::Chat),
            other => Err(format!("unknown memory scope: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    Identity,
    Preference,
    Goal,
    Project,
    Relationship,
    Event,
    Instruction,
    Other,
}

impl MemoryCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            MemoryCategory::Identity => "identity",
            MemoryCategory::Preference => "preference",
            MemoryCategory::Goal => "goal",
            MemoryCategory::Project => "project",
            MemoryCategory::Relationship => "relationship",
            MemoryCategory::Event => "event",
            MemoryCategory::Instruction => "instruction",
            MemoryCategory::Other => "other",
        }
    }
}

impl Display for MemoryCategory {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for MemoryCategory {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "identity" => Ok(MemoryCategory::Identity),
            "preference" => Ok(MemoryCategory::Preference),
            "goal" => Ok(MemoryCategory::Goal),
            "project" => Ok(MemoryCategory::Project),
            "relationship" => Ok(MemoryCategory::Relationship),
            "event" => Ok(MemoryCategory::Event),
            "instruction" => Ok(MemoryCategory::Instruction),
            "other" => Ok(MemoryCategory::Other),
            other => Err(format!("unknown memory category: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOperationKind {
    Add,
    Update,
    Supersede,
    Delete,
    Noop,
}

impl MemoryOperationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MemoryOperationKind::Add => "add",
            MemoryOperationKind::Update => "update",
            MemoryOperationKind::Supersede => "supersede",
            MemoryOperationKind::Delete => "delete",
            MemoryOperationKind::Noop => "noop",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingState {
    Pending,
    Processing,
    Completed,
    Failed,
    Skipped,
}

impl ProcessingState {
    pub fn as_str(self) -> &'static str {
        match self {
            ProcessingState::Pending => "pending",
            ProcessingState::Processing => "processing",
            ProcessingState::Completed => "completed",
            ProcessingState::Failed => "failed",
            ProcessingState::Skipped => "skipped",
        }
    }
}

impl Display for ProcessingState {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for ProcessingState {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "pending" => Ok(ProcessingState::Pending),
            "processing" => Ok(ProcessingState::Processing),
            "completed" => Ok(ProcessingState::Completed),
            "failed" => Ok(ProcessingState::Failed),
            "skipped" => Ok(ProcessingState::Skipped),
            other => Err(format!("unknown memory processing state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemorySyncOperation {
    Upsert,
    Delete,
    Reindex,
}

impl MemorySyncOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            MemorySyncOperation::Upsert => "upsert",
            MemorySyncOperation::Delete => "delete",
            MemorySyncOperation::Reindex => "reindex",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: String,
    pub owner_id: String,
    pub scope: MemoryScope,
    pub scope_owner_id: String,
    pub category: MemoryCategory,
    pub canonical_key: Option<String>,
    pub value: Value,
    pub summary: String,
    pub confidence: f32,
    pub importance: f32,
    pub source_chat_id: Option<String>,
    pub source_message_ids: Vec<String>,
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub supersedes_id: Option<String>,
    pub is_active: bool,
    pub deleted_at: Option<DateTime<Utc>>,
    pub sync_status: String,
    pub sync_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySettings {
    pub owner_id: String,
    pub enabled: bool,
    pub provider: String,
    pub automatic_extraction: bool,
    pub require_sensitive_confirmation: bool,
    pub enable_user_memory: bool,
    pub enable_project_memory: bool,
    pub enable_chat_memory: bool,
    pub allow_temporary_recall: bool,
    pub retrieval_limit: i64,
    pub token_budget: i64,
    pub extraction_provider_id: Option<i64>,
    pub extraction_provider: Option<String>,
    pub extraction_model: Option<String>,
    pub extraction_api_base_url: Option<String>,
    pub embedding_provider_id: Option<i64>,
    pub embedding_provider: Option<String>,
    pub embedding_model: Option<String>,
    pub embedding_api_base_url: Option<String>,
    pub mem0_endpoint: Option<String>,
    pub locality: String,
}

impl MemorySettings {
    pub fn disabled(owner_id: impl Into<String>) -> Self {
        Self {
            owner_id: owner_id.into(),
            enabled: false,
            provider: "disabled".to_string(),
            automatic_extraction: false,
            require_sensitive_confirmation: true,
            enable_user_memory: true,
            enable_project_memory: true,
            enable_chat_memory: true,
            allow_temporary_recall: false,
            retrieval_limit: 8,
            token_budget: 600,
            extraction_provider_id: None,
            extraction_provider: None,
            extraction_model: None,
            extraction_api_base_url: None,
            embedding_provider_id: None,
            embedding_provider: None,
            embedding_model: None,
            embedding_api_base_url: None,
            mem0_endpoint: None,
            locality: "local".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScopeOwner {
    pub scope: MemoryScope,
    pub scope_owner_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryOperation {
    pub operation: MemoryOperationKind,
    pub memory_id: Option<String>,
    pub scope: MemoryScope,
    pub scope_owner_id: String,
    pub category: MemoryCategory,
    pub canonical_key: Option<String>,
    pub value: Option<Value>,
    pub summary: Option<String>,
    pub confidence: Option<f32>,
    pub importance: Option<f32>,
    pub source_chat_id: Option<String>,
    pub source_message_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryOperationResult {
    pub operation: MemoryOperationKind,
    pub memory_id: Option<String>,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListQuery {
    pub owner_id: String,
    pub scope: Option<MemoryScope>,
    pub scope_owner_id: Option<String>,
    pub category: Option<MemoryCategory>,
    pub include_inactive: bool,
    pub include_deleted: bool,
    pub include_superseded: bool,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchQuery {
    pub owner_id: String,
    pub query: String,
    pub scope: Option<MemoryScope>,
    pub scope_owner_id: Option<String>,
    pub category: Option<MemoryCategory>,
    pub include_inactive: bool,
    pub include_deleted: bool,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecallQuery {
    pub owner_id: String,
    pub query: String,
    pub scopes: Vec<MemoryScopeOwner>,
    pub limit: i64,
    pub token_budget: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdateInput {
    pub owner_id: String,
    pub memory_id: String,
    pub category: Option<MemoryCategory>,
    pub canonical_key: Option<String>,
    pub value: Option<Value>,
    pub summary: Option<String>,
    pub confidence: Option<f32>,
    pub importance: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCompletedTurnInput {
    pub owner_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCompletedTurnRecordInput {
    pub owner_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub user_scope_owner_id: Option<String>,
    pub project_scope_owner_id: Option<String>,
    pub chat_scope_owner_id: Option<String>,
    pub skip_reason: Option<String>,
    pub user_content: String,
    pub assistant_content: String,
    pub assistant_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTurnInput {
    pub owner_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub user_content: String,
    pub assistant_content: String,
    pub scopes: Vec<MemoryScopeOwner>,
    /// Model the user is chatting with; preferred extraction fallback when no
    /// explicit extraction model is configured.
    #[serde(default)]
    pub chat_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProcessingRecord {
    pub turn_id: String,
    pub owner_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub state: ProcessingState,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}
