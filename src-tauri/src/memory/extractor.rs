use crate::memory::canonical::normalize_canonical_key;
use crate::memory::error::MemoryError;
use crate::memory::filter::{DeterministicSensitiveDataFilter, SensitiveDataFilter};
use crate::memory::repository::{MemoryRepository, SqliteMemoryRepository};
use crate::memory::types::{
    MemoryCategory, MemoryListQuery, MemoryOperation, MemoryOperationKind, MemoryScope,
    MemorySettings, MemoryTurnInput,
};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

#[async_trait]
pub trait MemoryExtractor: Send + Sync {
    async fn extract(&self, input: MemoryTurnInput) -> Result<Vec<MemoryOperation>, MemoryError>;
}

const MAX_MEMORIES_PER_TURN: usize = 8;
const MAX_TURN_CHARS: usize = 4000;
const MAX_CONTEXT_MESSAGE_CHARS: usize = 500;
const MAX_CONTEXT_MESSAGES: i64 = 10;
const MAX_EXISTING_MEMORIES: i64 = 50;

const EXTRACTION_SYSTEM_PROMPT: &str = r#"You extract factual memories from conversations. Extract clear, standalone facts about the user.
Return a JSON object: {"memories": [...]}. Each entry has: value (string), summary (string, one line), category, confidence (0-1), importance (0-1), canonical_key (string or null).

Allowed categories: identity, preference, goal, project, relationship, event, instruction, other.

Rules:
- If the user explicitly asks to remember, note, or save something, always extract it with confidence 0.9 or higher.
- Store the fact itself, never the user's phrasing of the request. "remember that I am 16" becomes value "User is 16 years old", not the command text.
- Only extract definite facts, not speculation.
- Do not re-extract facts already listed under existing memories.
- Prefer canonical keys for mergeable facts (e.g. "user_name", "user_job", "user_location"); use lowercase letters, digits, underscores and dots only.
- Set confidence below 0.6 if the fact is implied rather than stated.
- Set importance based on: identity facts > preferences > other facts > topics.
- Return {"memories": []} when the turn contains nothing worth remembering."#;

fn strip_thinking_blocks(content: &str) -> String {
    content
        .split("</think>")
        .last()
        .unwrap_or(content)
        .trim()
        .to_string()
}

/// LLM-backed extractor. Resolves provider/model from memory settings
/// (falling back to the active chat provider) and asks it for JSON memories.
#[derive(Clone)]
pub struct LlmMemoryExtractor {
    pool: SqlitePool,
    secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
    ai: Arc<crate::ai_sidecar::AiSidecar>,
}

impl LlmMemoryExtractor {
    pub fn new(
        pool: SqlitePool,
        secret_store: Arc<dyn crate::connections::secrets::SecretStore>,
        ai: Arc<crate::ai_sidecar::AiSidecar>,
    ) -> Self {
        Self {
            pool,
            secret_store,
            ai,
        }
    }

    async fn recent_context(
        &self,
        input: &MemoryTurnInput,
    ) -> Result<Vec<(String, String)>, MemoryError> {
        let rows = sqlx::query(
            "SELECT role, content FROM messages WHERE conversationId = ?1 AND id NOT IN (?2, ?3) ORDER BY createdAt DESC LIMIT ?4",
        )
        .bind(&input.conversation_id)
        .bind(&input.user_message_id)
        .bind(&input.assistant_message_id)
        .bind(MAX_CONTEXT_MESSAGES)
        .fetch_all(&self.pool)
        .await?;
        let mut context: Vec<(String, String)> = rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<String, _>("role"),
                    row.get::<String, _>("content"),
                )
            })
            .collect();
        context.reverse();
        Ok(context)
    }

    async fn existing_memory_summaries(&self, owner_id: &str) -> Result<Vec<String>, MemoryError> {
        let repository = SqliteMemoryRepository::new(self.pool.clone());
        let records = repository
            .list(MemoryListQuery {
                owner_id: owner_id.to_string(),
                scope: Some(MemoryScope::User),
                scope_owner_id: Some(owner_id.to_string()),
                category: None,
                include_inactive: false,
                include_deleted: false,
                include_superseded: false,
                limit: Some(MAX_EXISTING_MEMORIES),
                offset: None,
            })
            .await?;
        Ok(records.into_iter().map(|record| record.summary).collect())
    }

    async fn run_completion(
        &self,
        connection: &crate::connections::Connection,
        model: &str,
        prompt: String,
    ) -> Result<String, MemoryError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let result = self
            .ai
            .request(
                &request_id,
                serde_json::json!({
                    "type": "generate",
                    "requestId": request_id,
                    "connection": crate::commands::ai_runtime_commands::sidecar_connection(
                        self.secret_store.as_ref(),
                        connection,
                        Some(model),
                        None,
                    ).map_err(MemoryError::ProviderUnavailable)?,
                    "prompt": prompt,
                    "instructions": EXTRACTION_SYSTEM_PROMPT,
                }),
            )
            .await
            .map_err(MemoryError::ProviderUnavailable)?;
        result
            .get("text")
            .and_then(serde_json::Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map(str::to_string)
            .ok_or_else(|| MemoryError::StructuredOutputFailure("empty response".to_string()))
    }
}

#[async_trait]
impl MemoryExtractor for LlmMemoryExtractor {
    async fn extract(&self, input: MemoryTurnInput) -> Result<Vec<MemoryOperation>, MemoryError> {
        // ponytail: all extracted memories are user-scoped for now; per-scope routing later
        let user_scope_enabled = input.scopes.iter().any(|scope| {
            scope.scope == MemoryScope::User && scope.scope_owner_id == input.owner_id
        });
        if !user_scope_enabled {
            return Ok(Vec::new());
        }

        let repository = SqliteMemoryRepository::new(self.pool.clone());
        let settings = repository.get_settings(&input.owner_id).await?;
        let (connection, model) = resolve_extraction_target(
            &self.pool,
            &settings,
            &input.owner_id,
            input.chat_model.as_deref(),
        )
        .await?;

        let existing = self.existing_memory_summaries(&input.owner_id).await?;
        let context = self.recent_context(&input).await?;
        let prompt = build_extraction_prompt(&input, &context, &existing);

        let raw = self.run_completion(&connection, &model, prompt).await?;
        let entries = parse_extracted_memories(&raw);
        Ok(convert_extracted_memories(entries, &input, &existing))
    }
}

/// Shared by extraction and the settings "test connection" button.
pub async fn resolve_extraction_target(
    pool: &SqlitePool,
    settings: &MemorySettings,
    owner_id: &str,
    chat_model: Option<&str>,
) -> Result<(crate::connections::Connection, String), MemoryError> {
    let connections = crate::connections::repository::list_connections(pool, owner_id)
        .await
        .map_err(MemoryError::ProviderUnavailable)?;
    let requested_model = settings
        .extraction_model
        .as_deref()
        .or(chat_model)
        .map(str::trim)
        .filter(|model| !model.is_empty());

    let mut matches = Vec::new();
    for connection in connections
        .into_iter()
        .filter(|connection| connection.enabled)
    {
        let models = crate::connections::repository::list_models(pool, &connection.id)
            .await
            .map_err(MemoryError::ProviderUnavailable)?;
        if let Some(model) = requested_model {
            if models.iter().any(|entry| {
                entry.enabled
                    && (entry.remote_id == model
                        || entry.aliases.iter().any(|alias| alias == model))
            }) {
                matches.push((connection, model.to_string()));
            }
        } else if let Some(model) = models.into_iter().find(|model| model.enabled) {
            matches.push((connection, model.remote_id));
        }
    }
    let (connection, model) = match matches.len() {
        1 => matches.remove(0),
        0 => {
            return Err(MemoryError::UnsupportedModel(
                "no enabled connection offers an extraction model".into(),
            ))
        }
        _ => return Err(MemoryError::ProviderUnavailable(
            "more than one connection offers the extraction model; choose one in memory settings"
                .into(),
        )),
    };
    Ok((connection, model))
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn build_extraction_prompt(
    input: &MemoryTurnInput,
    context: &[(String, String)],
    existing: &[String],
) -> String {
    let mut prompt = String::new();

    prompt.push_str("Existing memories (do not re-extract duplicates):\n");
    if existing.is_empty() {
        prompt.push_str("(none)\n");
    } else {
        for summary in existing {
            prompt.push_str("- ");
            prompt.push_str(summary);
            prompt.push('\n');
        }
    }

    if !context.is_empty() {
        prompt.push_str("\nRecent conversation:\n");
        for (role, content) in context {
            let role = if role == "assistant" {
                "Assistant"
            } else {
                "User"
            };
            prompt.push_str(role);
            prompt.push_str(": ");
            prompt.push_str(&truncate_chars(content, MAX_CONTEXT_MESSAGE_CHARS));
            prompt.push('\n');
        }
    }

    prompt.push_str("\nExtract memories from this turn:\n");
    prompt.push_str("User: ");
    prompt.push_str(&truncate_chars(&input.user_content, MAX_TURN_CHARS));
    if !input.assistant_content.trim().is_empty() {
        prompt.push_str("\nAssistant: ");
        prompt.push_str(&truncate_chars(&input.assistant_content, MAX_TURN_CHARS));
    }
    prompt.push('\n');
    prompt
}

#[derive(Debug, Deserialize)]
struct RawExtractedMemory {
    value: Option<Value>,
    summary: Option<String>,
    category: Option<String>,
    confidence: Option<f32>,
    importance: Option<f32>,
    canonical_key: Option<String>,
}

fn parse_extracted_memories(raw: &str) -> Vec<RawExtractedMemory> {
    let cleaned = strip_thinking_blocks(raw);
    let cleaned = cleaned
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```JSON")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    let mut candidates = vec![cleaned.clone()];
    if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
        if end > start {
            candidates.push(cleaned[start..=end].to_string());
        }
    }
    if let (Some(start), Some(end)) = (cleaned.find('['), cleaned.rfind(']')) {
        if end > start {
            candidates.push(cleaned[start..=end].to_string());
        }
    }

    for candidate in candidates {
        let Ok(value) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        let entries = match value {
            Value::Array(entries) => entries,
            Value::Object(mut object) => match object.remove("memories") {
                Some(Value::Array(entries)) => entries,
                _ => continue,
            },
            _ => continue,
        };
        return entries
            .into_iter()
            .filter_map(|entry| serde_json::from_value::<RawExtractedMemory>(entry).ok())
            .collect();
    }

    Vec::new()
}

fn convert_extracted_memories(
    entries: Vec<RawExtractedMemory>,
    input: &MemoryTurnInput,
    existing: &[String],
) -> Vec<MemoryOperation> {
    let filter = DeterministicSensitiveDataFilter;
    let existing_lower: Vec<String> = existing.iter().map(|s| s.trim().to_lowercase()).collect();
    let mut seen: Vec<String> = Vec::new();
    let mut operations = Vec::new();
    // User-only extraction passes the same id for both; keep sources unique.
    let mut source_message_ids = vec![
        input.user_message_id.clone(),
        input.assistant_message_id.clone(),
    ];
    source_message_ids.dedup();

    for entry in entries {
        if operations.len() >= MAX_MEMORIES_PER_TURN {
            break;
        }

        let value = match entry.value {
            Some(Value::String(text)) => {
                let text = text.trim().to_string();
                if text.is_empty() {
                    continue;
                }
                Value::String(text)
            }
            Some(Value::Null) | None => continue,
            Some(other) => other,
        };
        let value_text = match &value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };

        let summary = entry
            .summary
            .map(|summary| summary.trim().to_string())
            .filter(|summary| !summary.is_empty())
            .unwrap_or_else(|| truncate_chars(&value_text, 180));

        // Skip duplicates against existing memories and within this batch.
        let dedupe_key = value_text.trim().to_lowercase();
        let summary_lower = summary.to_lowercase();
        if existing_lower
            .iter()
            .any(|known| known == &summary_lower || known == &dedupe_key)
            || seen.contains(&dedupe_key)
        {
            continue;
        }

        // Drop sensitive entries instead of failing the whole turn.
        if filter.inspect(&value_text).rejected || filter.inspect(&summary).rejected {
            continue;
        }

        let category = entry
            .category
            .as_deref()
            .and_then(|category| category.parse::<MemoryCategory>().ok())
            .unwrap_or(MemoryCategory::Other);
        let canonical_key = entry
            .canonical_key
            .as_deref()
            .and_then(|key| normalize_canonical_key(key).ok());

        seen.push(dedupe_key);
        operations.push(MemoryOperation {
            operation: MemoryOperationKind::Add,
            memory_id: None,
            scope: MemoryScope::User,
            scope_owner_id: input.owner_id.clone(),
            category,
            canonical_key,
            value: Some(value),
            summary: Some(summary),
            confidence: Some(entry.confidence.unwrap_or(0.6).clamp(0.0, 1.0)),
            importance: Some(entry.importance.unwrap_or(0.5).clamp(0.0, 1.0)),
            source_chat_id: Some(input.conversation_id.clone()),
            source_message_ids: source_message_ids.clone(),
        });
    }

    operations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::types::MemoryScopeOwner;

    fn turn_input() -> MemoryTurnInput {
        MemoryTurnInput {
            owner_id: "owner-1".to_string(),
            conversation_id: "conv-1".to_string(),
            user_message_id: "msg-user".to_string(),
            assistant_message_id: "msg-assistant".to_string(),
            user_content: "My name is John".to_string(),
            assistant_content: "Nice to meet you, John".to_string(),
            scopes: vec![MemoryScopeOwner {
                scope: MemoryScope::User,
                scope_owner_id: "owner-1".to_string(),
            }],
            chat_model: None,
        }
    }

    #[test]
    fn parses_memories_object_with_fences_and_thinking() {
        let raw = "<think>hmm</think>```json\n{\"memories\":[{\"value\":\"User is named John\",\"summary\":\"User's name is John\",\"category\":\"identity\",\"confidence\":0.95,\"importance\":0.9,\"canonical_key\":\"user_name\"}]}\n```";
        let entries = parse_extracted_memories(raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].canonical_key.as_deref(), Some("user_name"));
    }

    #[test]
    fn parses_bare_array() {
        let raw = r#"[{"value":"Prefers Bun","summary":"Prefers Bun","category":"preference","confidence":0.8,"importance":0.6}]"#;
        assert_eq!(parse_extracted_memories(raw).len(), 1);
    }

    #[test]
    fn conversion_validates_dedupes_and_filters_sensitive() {
        let entries = parse_extracted_memories(
            r#"{"memories":[
                {"value":"User is named John","summary":"User's name is John","category":"identity","confidence":1.5,"importance":0.9,"canonical_key":"user_name"},
                {"value":"User is named John","summary":"Duplicate in batch","category":"identity","confidence":0.9,"importance":0.9},
                {"value":"Prefers Bun for JS","summary":"Prefers Bun","category":"preference","confidence":0.8,"importance":0.6},
                {"value":"API key is sk-secret123","summary":"User API key","category":"other","confidence":0.9,"importance":0.9},
                {"value":"","summary":"empty","category":"other","confidence":0.5,"importance":0.5},
                {"value":"Bad key","summary":"Bad key","category":"weird_category","confidence":0.5,"importance":0.5,"canonical_key":"has spaces!"}
            ]}"#,
        );
        let ops = convert_extracted_memories(entries, &turn_input(), &["prefers bun".to_string()]);

        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].canonical_key.as_deref(), Some("user_name"));
        assert_eq!(ops[0].confidence, Some(1.0));
        assert_eq!(ops[0].scope, MemoryScope::User);
        assert_eq!(ops[0].source_chat_id.as_deref(), Some("conv-1"));
        // unknown category falls back to Other, invalid canonical key dropped
        assert_eq!(ops[1].category, MemoryCategory::Other);
        assert_eq!(ops[1].canonical_key, None);
    }

    #[test]
    fn skips_extraction_when_user_scope_disabled() {
        let mut input = turn_input();
        input.scopes.clear();
        let entries = parse_extracted_memories(r#"{"memories":[]}"#);
        assert!(convert_extracted_memories(entries, &input, &[]).is_empty());
    }
}
