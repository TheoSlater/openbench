use crate::memory::canonical::{
    clamp_score, merge_source_message_ids, normalize_optional_canonical_key, summary_for,
    validate_operation,
};
use crate::memory::error::MemoryError;
use crate::memory::processing::{completed_turn_id, is_completed_success, is_substantive_turn};
use crate::memory::types::{
    MemoryCompletedTurnRecordInput, MemoryListQuery, MemoryOperation, MemoryOperationKind,
    MemoryOperationResult, MemoryProcessingRecord, MemoryRecallQuery, MemoryRecord, MemoryScope,
    MemorySearchQuery, MemorySettings, MemorySyncOperation, MemoryUpdateInput, ProcessingState,
};
use async_trait::async_trait;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::{json, Value};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

#[async_trait]
pub trait MemoryRepository: Send + Sync {
    async fn get_settings(&self, owner_id: &str) -> Result<MemorySettings, MemoryError>;
    async fn update_settings(
        &self,
        settings: MemorySettings,
    ) -> Result<MemorySettings, MemoryError>;
    async fn list(&self, query: MemoryListQuery) -> Result<Vec<MemoryRecord>, MemoryError>;
    async fn search(&self, query: MemorySearchQuery) -> Result<Vec<MemoryRecord>, MemoryError>;
    async fn recall(&self, query: MemoryRecallQuery) -> Result<Vec<MemoryRecord>, MemoryError>;
    async fn apply_operations(
        &self,
        owner_id: &str,
        operations: Vec<MemoryOperation>,
        sync_provider: Option<&str>,
    ) -> Result<Vec<MemoryOperationResult>, MemoryError>;
    async fn update_memory(&self, input: MemoryUpdateInput) -> Result<MemoryRecord, MemoryError>;
    async fn delete_memory(
        &self,
        owner_id: &str,
        memory_id: &str,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError>;
    async fn clear_scope(
        &self,
        owner_id: &str,
        scope: MemoryScope,
        scope_owner_id: Option<&str>,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError>;
    async fn clear_all(
        &self,
        owner_id: &str,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError>;
    async fn get_processing_turn(
        &self,
        turn_id: &str,
    ) -> Result<Option<MemoryProcessingRecord>, MemoryError>;
    async fn claim_processing_turn(
        &self,
        turn_id: &str,
    ) -> Result<Option<MemoryProcessingRecord>, MemoryError>;
    async fn finish_processing_turn(
        &self,
        turn_id: &str,
        state: ProcessingState,
        message: Option<&str>,
    ) -> Result<MemoryProcessingRecord, MemoryError>;
    async fn enqueue_completed_turn(
        &self,
        input: MemoryCompletedTurnRecordInput,
    ) -> Result<MemoryProcessingRecord, MemoryError>;
}

#[derive(Clone)]
pub struct SqliteMemoryRepository {
    pool: SqlitePool,
}

impl SqliteMemoryRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Active memories that came from a conversation or are scoped to it.
    pub async fn list_for_chat(
        &self,
        owner_id: &str,
        conversation_id: &str,
    ) -> Result<Vec<MemoryRecord>, MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let rows = sqlx::query(
            "SELECT * FROM memory_records WHERE owner_id = ?1 AND is_active = 1 AND deleted_at IS NULL AND (source_chat_id = ?2 OR (scope = 'chat' AND scope_owner_id = ?2)) ORDER BY created_at DESC LIMIT 200",
        )
        .bind(owner_id)
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(row_to_record).collect()
    }

    async fn apply_operation_tx(
        tx: &mut Transaction<'_, Sqlite>,
        owner_id: &str,
        operation: MemoryOperation,
        sync_provider: Option<&str>,
    ) -> Result<MemoryOperationResult, MemoryError> {
        validate_operation(&operation)?;
        let canonical_key = normalize_optional_canonical_key(operation.canonical_key.clone())?;

        match operation.operation {
            MemoryOperationKind::Noop => Ok(MemoryOperationResult {
                operation: MemoryOperationKind::Noop,
                memory_id: None,
                status: "noop".to_string(),
                message: "No memory change required".to_string(),
            }),
            MemoryOperationKind::Delete => {
                let target = if let Some(memory_id) = operation.memory_id.as_deref() {
                    Self::record_by_id_tx(tx, owner_id, memory_id).await?
                } else if let Some(key) = canonical_key.as_deref() {
                    Self::active_by_key_tx(
                        tx,
                        owner_id,
                        operation.scope,
                        &operation.scope_owner_id,
                        key,
                    )
                    .await?
                } else {
                    return Err(MemoryError::InvalidMemoryOperation(
                        "delete requires memory id or canonical key".to_string(),
                    ));
                };

                let Some(target) = target else {
                    return Ok(MemoryOperationResult {
                        operation: MemoryOperationKind::Delete,
                        memory_id: None,
                        status: "noop".to_string(),
                        message: "No active memory matched delete operation".to_string(),
                    });
                };

                Self::mark_deleted_tx(tx, &target.id).await?;
                Self::enqueue_memory_sync_tx(
                    tx,
                    sync_provider,
                    &target.id,
                    MemorySyncOperation::Delete,
                )
                .await?;

                Ok(MemoryOperationResult {
                    operation: MemoryOperationKind::Delete,
                    memory_id: Some(target.id),
                    status: "deleted".to_string(),
                    message: "Memory deleted".to_string(),
                })
            }
            MemoryOperationKind::Supersede => {
                let key = canonical_key.ok_or_else(|| {
                    MemoryError::InvalidMemoryOperation(
                        "supersede requires canonical key".to_string(),
                    )
                })?;
                let old = Self::active_by_key_tx(
                    tx,
                    owner_id,
                    operation.scope,
                    &operation.scope_owner_id,
                    &key,
                )
                .await?;
                if let Some(old) = old.as_ref() {
                    Self::mark_superseded_tx(tx, &old.id).await?;
                    Self::enqueue_memory_sync_tx(
                        tx,
                        sync_provider,
                        &old.id,
                        MemorySyncOperation::Delete,
                    )
                    .await?;
                }
                let new_id = Self::insert_record_tx(
                    tx,
                    owner_id,
                    &operation,
                    Some(key),
                    old.as_ref().map(|record| record.id.as_str()),
                )
                .await?;
                Self::enqueue_memory_sync_tx(
                    tx,
                    sync_provider,
                    &new_id,
                    MemorySyncOperation::Upsert,
                )
                .await?;
                Ok(MemoryOperationResult {
                    operation: MemoryOperationKind::Supersede,
                    memory_id: Some(new_id),
                    status: "superseded".to_string(),
                    message: "Memory superseded previous canonical value".to_string(),
                })
            }
            MemoryOperationKind::Add | MemoryOperationKind::Update => {
                if let Some(memory_id) = operation.memory_id.as_deref() {
                    let Some(existing) = Self::record_by_id_tx(tx, owner_id, memory_id).await?
                    else {
                        return Err(MemoryError::NotFound(memory_id.to_string()));
                    };
                    Self::update_existing_tx(tx, &existing, &operation, canonical_key.as_deref())
                        .await?;
                    Self::enqueue_memory_sync_tx(
                        tx,
                        sync_provider,
                        &existing.id,
                        MemorySyncOperation::Upsert,
                    )
                    .await?;
                    return Ok(MemoryOperationResult {
                        operation: operation.operation,
                        memory_id: Some(existing.id),
                        status: "updated".to_string(),
                        message: "Memory updated".to_string(),
                    });
                }

                let existing = match canonical_key.as_deref() {
                    Some(key) => {
                        Self::active_by_key_tx(
                            tx,
                            owner_id,
                            operation.scope,
                            &operation.scope_owner_id,
                            key,
                        )
                        .await?
                    }
                    None => None,
                };

                if let Some(existing) = existing {
                    Self::update_existing_tx(tx, &existing, &operation, canonical_key.as_deref())
                        .await?;
                    Self::enqueue_memory_sync_tx(
                        tx,
                        sync_provider,
                        &existing.id,
                        MemorySyncOperation::Upsert,
                    )
                    .await?;
                    Ok(MemoryOperationResult {
                        operation: operation.operation,
                        memory_id: Some(existing.id),
                        status: "updated_existing".to_string(),
                        message: "Active canonical memory updated".to_string(),
                    })
                } else {
                    let new_id =
                        Self::insert_record_tx(tx, owner_id, &operation, canonical_key, None)
                            .await?;
                    Self::enqueue_memory_sync_tx(
                        tx,
                        sync_provider,
                        &new_id,
                        MemorySyncOperation::Upsert,
                    )
                    .await?;
                    Ok(MemoryOperationResult {
                        operation: operation.operation,
                        memory_id: Some(new_id),
                        status: "added".to_string(),
                        message: "Memory added".to_string(),
                    })
                }
            }
        }
    }

    async fn insert_record_tx(
        tx: &mut Transaction<'_, Sqlite>,
        owner_id: &str,
        operation: &MemoryOperation,
        canonical_key: Option<String>,
        supersedes_id: Option<&str>,
    ) -> Result<String, MemoryError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let value = operation.value.clone().ok_or_else(|| {
            MemoryError::InvalidMemoryOperation("memory value is required".to_string())
        })?;
        let summary = summary_for(&value, operation.summary.clone());
        let source_ids = serde_json::to_string(&operation.source_message_ids)?;
        sqlx::query(
            r#"
            INSERT INTO memory_records (
                id, owner_id, scope, scope_owner_id, category, canonical_key,
                value_json, summary, confidence, importance, source_chat_id,
                source_message_ids, valid_from, supersedes_id, is_active,
                sync_status, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, 'local', ?13, ?13)
            "#,
        )
        .bind(&id)
        .bind(owner_id)
        .bind(operation.scope.to_string())
        .bind(operation.scope_owner_id.trim())
        .bind(operation.category.to_string())
        .bind(canonical_key.as_deref())
        .bind(value.to_string())
        .bind(summary)
        .bind(clamp_score(operation.confidence, 0.75))
        .bind(clamp_score(operation.importance, 0.5))
        .bind(operation.source_chat_id.as_deref())
        .bind(&source_ids)
        .bind(&now)
        .bind(supersedes_id)
        .execute(&mut **tx)
        .await?;

        Self::replace_sources_tx(
            tx,
            &id,
            operation.source_chat_id.as_deref(),
            &operation.source_message_ids,
        )
        .await?;

        Ok(id)
    }

    async fn update_existing_tx(
        tx: &mut Transaction<'_, Sqlite>,
        existing: &MemoryRecord,
        operation: &MemoryOperation,
        canonical_key: Option<&str>,
    ) -> Result<(), MemoryError> {
        let value = operation
            .value
            .clone()
            .unwrap_or_else(|| existing.value.clone());
        let summary = summary_for(
            &value,
            operation
                .summary
                .clone()
                .or_else(|| Some(existing.summary.clone())),
        );
        let now = Utc::now().to_rfc3339();
        let existing_source_json = serde_json::to_string(&existing.source_message_ids)?;
        let merged_sources =
            merge_source_message_ids(&existing_source_json, &operation.source_message_ids)?;
        let source_ids_json = serde_json::to_string(&merged_sources)?;

        sqlx::query(
            r#"
            UPDATE memory_records
            SET category = ?1,
                canonical_key = ?2,
                value_json = ?3,
                summary = ?4,
                confidence = ?5,
                importance = ?6,
                source_chat_id = COALESCE(?7, source_chat_id),
                source_message_ids = ?8,
                sync_status = 'local',
                sync_error = NULL,
                updated_at = ?9
            WHERE id = ?10
            "#,
        )
        .bind(operation.category.to_string())
        .bind(canonical_key.or(existing.canonical_key.as_deref()))
        .bind(value.to_string())
        .bind(summary)
        .bind(clamp_score(operation.confidence, existing.confidence))
        .bind(clamp_score(operation.importance, existing.importance))
        .bind(operation.source_chat_id.as_deref())
        .bind(&source_ids_json)
        .bind(&now)
        .bind(&existing.id)
        .execute(&mut **tx)
        .await?;

        Self::replace_sources_tx(
            tx,
            &existing.id,
            operation
                .source_chat_id
                .as_deref()
                .or(existing.source_chat_id.as_deref()),
            &merged_sources,
        )
        .await
    }

    async fn mark_superseded_tx(
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: &str,
    ) -> Result<(), MemoryError> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE memory_records SET is_active = 0, valid_until = COALESCE(valid_until, ?1), sync_status = 'local', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(memory_id)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn mark_deleted_tx(
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: &str,
    ) -> Result<(), MemoryError> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE memory_records SET is_active = 0, deleted_at = ?1, valid_until = COALESCE(valid_until, ?1), sync_status = 'local', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(memory_id)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn mark_deleted_at_tx(
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: &str,
        deleted_at: &str,
    ) -> Result<(), MemoryError> {
        sqlx::query("UPDATE memory_records SET is_active = 0, deleted_at = ?1, valid_until = COALESCE(valid_until, ?1), updated_at = ?1 WHERE id = ?2")
            .bind(deleted_at)
            .bind(memory_id)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }

    async fn enqueue_sync_tx(
        tx: &mut Transaction<'_, Sqlite>,
        provider: Option<&str>,
        local_memory_id: Option<&str>,
        operation: MemorySyncOperation,
        payload: Value,
    ) -> Result<(), MemoryError> {
        let Some(provider) = provider
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "disabled")
        else {
            return Ok(());
        };
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO memory_outbox (
                id, local_memory_id, provider, operation, payload_json,
                attempt_count, next_retry_at, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(local_memory_id)
        .bind(provider)
        .bind(operation.as_str())
        .bind(payload.to_string())
        .bind(&now)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn enqueue_memory_sync_tx(
        tx: &mut Transaction<'_, Sqlite>,
        provider: Option<&str>,
        memory_id: &str,
        operation: MemorySyncOperation,
    ) -> Result<(), MemoryError> {
        Self::enqueue_sync_tx(
            tx,
            provider,
            Some(memory_id),
            operation,
            json!({ "memoryId": memory_id }),
        )
        .await
    }

    async fn record_by_id_tx(
        tx: &mut Transaction<'_, Sqlite>,
        owner_id: &str,
        memory_id: &str,
    ) -> Result<Option<MemoryRecord>, MemoryError> {
        let row = sqlx::query("SELECT * FROM memory_records WHERE owner_id = ?1 AND id = ?2")
            .bind(owner_id)
            .bind(memory_id)
            .fetch_optional(&mut **tx)
            .await?;
        row.map(row_to_record).transpose()
    }

    async fn active_by_key_tx(
        tx: &mut Transaction<'_, Sqlite>,
        owner_id: &str,
        scope: MemoryScope,
        scope_owner_id: &str,
        canonical_key: &str,
    ) -> Result<Option<MemoryRecord>, MemoryError> {
        let row = sqlx::query(
            r#"
            SELECT * FROM memory_records
            WHERE owner_id = ?1
              AND scope = ?2
              AND scope_owner_id = ?3
              AND canonical_key = ?4
              AND is_active = 1
              AND deleted_at IS NULL
            "#,
        )
        .bind(owner_id)
        .bind(scope.to_string())
        .bind(scope_owner_id)
        .bind(canonical_key)
        .fetch_optional(&mut **tx)
        .await?;
        row.map(row_to_record).transpose()
    }

    async fn replace_sources_tx(
        tx: &mut Transaction<'_, Sqlite>,
        memory_id: &str,
        chat_id: Option<&str>,
        source_message_ids: &[String],
    ) -> Result<(), MemoryError> {
        sqlx::query("DELETE FROM memory_record_sources WHERE memory_id = ?1")
            .bind(memory_id)
            .execute(&mut **tx)
            .await?;
        for message_id in source_message_ids
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
        {
            sqlx::query(
                "INSERT OR IGNORE INTO memory_record_sources (memory_id, message_id, chat_id) VALUES (?1, ?2, ?3)",
            )
            .bind(memory_id)
            .bind(message_id)
            .bind(chat_id)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }
}

#[async_trait]
impl MemoryRepository for SqliteMemoryRepository {
    async fn get_settings(&self, owner_id: &str) -> Result<MemorySettings, MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let row = sqlx::query("SELECT * FROM memory_settings WHERE owner_id = ?1")
            .bind(&owner_id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(row) => row_to_settings(row),
            None => Ok(MemorySettings::disabled(owner_id)),
        }
    }

    async fn update_settings(
        &self,
        settings: MemorySettings,
    ) -> Result<MemorySettings, MemoryError> {
        let owner_id = normalize_owner_id(&settings.owner_id)?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO memory_settings (
                owner_id, enabled, provider, automatic_extraction,
                require_sensitive_confirmation, enable_user_memory, enable_project_memory,
                enable_chat_memory, allow_temporary_recall,
                retrieval_limit, token_budget, extraction_provider_id,
                extraction_provider, extraction_model, extraction_api_base_url,
                embedding_provider_id, embedding_provider, embedding_model,
                embedding_api_base_url, mem0_endpoint, locality, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22)
            ON CONFLICT(owner_id) DO UPDATE SET
                enabled = excluded.enabled,
                provider = excluded.provider,
                automatic_extraction = excluded.automatic_extraction,
                require_sensitive_confirmation = excluded.require_sensitive_confirmation,
                enable_user_memory = excluded.enable_user_memory,
                enable_project_memory = excluded.enable_project_memory,
                enable_chat_memory = excluded.enable_chat_memory,
                allow_temporary_recall = excluded.allow_temporary_recall,
                retrieval_limit = excluded.retrieval_limit,
                token_budget = excluded.token_budget,
                extraction_provider_id = excluded.extraction_provider_id,
                extraction_provider = excluded.extraction_provider,
                extraction_model = excluded.extraction_model,
                extraction_api_base_url = excluded.extraction_api_base_url,
                embedding_provider_id = excluded.embedding_provider_id,
                embedding_provider = excluded.embedding_provider,
                embedding_model = excluded.embedding_model,
                embedding_api_base_url = excluded.embedding_api_base_url,
                mem0_endpoint = excluded.mem0_endpoint,
                locality = excluded.locality,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&owner_id)
        .bind(settings.enabled)
        .bind(settings.provider.trim())
        .bind(settings.automatic_extraction)
        .bind(settings.require_sensitive_confirmation)
        .bind(settings.enable_user_memory)
        .bind(settings.enable_project_memory)
        .bind(settings.enable_chat_memory)
        .bind(settings.allow_temporary_recall)
        .bind(settings.retrieval_limit.clamp(1, 50))
        .bind(settings.token_budget.clamp(64, 4_000))
        .bind(settings.extraction_provider_id)
        .bind(settings.extraction_provider.as_deref())
        .bind(settings.extraction_model.as_deref())
        .bind(settings.extraction_api_base_url.as_deref())
        .bind(settings.embedding_provider_id)
        .bind(settings.embedding_provider.as_deref())
        .bind(settings.embedding_model.as_deref())
        .bind(settings.embedding_api_base_url.as_deref())
        .bind(settings.mem0_endpoint.as_deref())
        .bind(settings.locality.trim())
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.get_settings(&owner_id).await
    }

    async fn list(&self, query: MemoryListQuery) -> Result<Vec<MemoryRecord>, MemoryError> {
        let owner_id = normalize_owner_id(&query.owner_id)?;
        let mut sql = "SELECT * FROM memory_records WHERE owner_id = ?".to_string();
        if query.scope.is_some() {
            sql.push_str(" AND scope = ?");
        }
        if query.scope_owner_id.is_some() {
            sql.push_str(" AND scope_owner_id = ?");
        }
        if query.category.is_some() {
            sql.push_str(" AND category = ?");
        }
        if !query.include_inactive {
            sql.push_str(" AND is_active = 1");
        }
        if !query.include_deleted {
            sql.push_str(" AND deleted_at IS NULL");
        }
        if !query.include_superseded {
            sql.push_str(" AND valid_until IS NULL");
        }
        sql.push_str(
            " ORDER BY importance DESC, confidence DESC, updated_at DESC LIMIT ? OFFSET ?",
        );

        let scope_text = query.scope.map(|scope| scope.to_string());
        let category_text = query.category.map(|category| category.to_string());
        let mut q = sqlx::query(&sql).bind(owner_id);
        if let Some(scope) = scope_text.as_deref() {
            q = q.bind(scope);
        }
        if let Some(scope_owner_id) = query.scope_owner_id.as_deref() {
            q = q.bind(scope_owner_id);
        }
        if let Some(category) = category_text.as_deref() {
            q = q.bind(category);
        }
        q = q.bind(query.limit.unwrap_or(100).clamp(1, 500));
        q = q.bind(query.offset.unwrap_or(0).max(0));
        let rows = q.fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_record).collect()
    }

    async fn search(&self, query: MemorySearchQuery) -> Result<Vec<MemoryRecord>, MemoryError> {
        let owner_id = normalize_owner_id(&query.owner_id)?;
        let needle = format!("%{}%", query.query.trim());
        let mut sql = "SELECT * FROM memory_records WHERE owner_id = ? AND (summary LIKE ? OR canonical_key LIKE ? OR value_json LIKE ?)".to_string();
        if query.scope.is_some() {
            sql.push_str(" AND scope = ?");
        }
        if query.scope_owner_id.is_some() {
            sql.push_str(" AND scope_owner_id = ?");
        }
        if query.category.is_some() {
            sql.push_str(" AND category = ?");
        }
        if !query.include_inactive {
            sql.push_str(" AND is_active = 1");
        }
        if !query.include_deleted {
            sql.push_str(" AND deleted_at IS NULL");
        }
        sql.push_str(" ORDER BY importance DESC, confidence DESC, updated_at DESC LIMIT ?");

        let scope_text = query.scope.map(|scope| scope.to_string());
        let category_text = query.category.map(|category| category.to_string());
        let mut q = sqlx::query(&sql)
            .bind(owner_id)
            .bind(&needle)
            .bind(&needle)
            .bind(&needle);
        if let Some(scope) = scope_text.as_deref() {
            q = q.bind(scope);
        }
        if let Some(scope_owner_id) = query.scope_owner_id.as_deref() {
            q = q.bind(scope_owner_id);
        }
        if let Some(category) = category_text.as_deref() {
            q = q.bind(category);
        }
        q = q.bind(query.limit.unwrap_or(50).clamp(1, 200));
        let rows = q.fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_record).collect()
    }

    async fn recall(&self, query: MemoryRecallQuery) -> Result<Vec<MemoryRecord>, MemoryError> {
        let owner_id = normalize_owner_id(&query.owner_id)?;
        if query.scopes.is_empty() {
            return Ok(Vec::new());
        }
        let now = Utc::now().to_rfc3339();
        let mut sql = "SELECT * FROM memory_records WHERE owner_id = ? AND is_active = 1 AND deleted_at IS NULL AND (valid_until IS NULL OR valid_until > ?) AND (".to_string();
        for idx in 0..query.scopes.len() {
            if idx > 0 {
                sql.push_str(" OR ");
            }
            sql.push_str("(scope = ? AND scope_owner_id = ?)");
        }
        sql.push(')');
        // ponytail: naive LIKE match is a ranking boost, not a gate — a whole
        // user message almost never appears verbatim inside a stored memory,
        // so gating on it returned nothing. Embedding-based relevance later.
        sql.push_str(" ORDER BY (CASE WHEN ? != '' AND (summary LIKE ? OR canonical_key LIKE ? OR value_json LIKE ?) THEN 1 ELSE 0 END) DESC, importance DESC, confidence DESC, COALESCE(last_used_at, updated_at) DESC LIMIT ?");

        let needle = if query.query.trim().is_empty() {
            String::new()
        } else {
            format!("%{}%", query.query.trim())
        };
        let mut q = sqlx::query(&sql).bind(owner_id).bind(now);
        for scope in &query.scopes {
            q = q
                .bind(scope.scope.to_string())
                .bind(scope.scope_owner_id.trim());
        }
        q = q
            .bind(query.query.trim())
            .bind(&needle)
            .bind(&needle)
            .bind(&needle);
        q = q.bind(query.limit.clamp(1, 50));
        let rows = q.fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_record).collect()
    }

    async fn apply_operations(
        &self,
        owner_id: &str,
        operations: Vec<MemoryOperation>,
        sync_provider: Option<&str>,
    ) -> Result<Vec<MemoryOperationResult>, MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let mut tx = self.pool.begin().await?;
        let mut results = Vec::new();
        for operation in operations {
            results.push(
                Self::apply_operation_tx(&mut tx, &owner_id, operation, sync_provider).await?,
            );
        }
        tx.commit().await?;
        Ok(results)
    }

    async fn update_memory(&self, input: MemoryUpdateInput) -> Result<MemoryRecord, MemoryError> {
        let owner_id = normalize_owner_id(&input.owner_id)?;
        let mut tx = self.pool.begin().await?;
        let existing = Self::record_by_id_tx(&mut tx, &owner_id, &input.memory_id)
            .await?
            .ok_or_else(|| MemoryError::NotFound(input.memory_id.clone()))?;

        let canonical_key = match input.canonical_key {
            Some(key) => Some(crate::memory::canonical::normalize_canonical_key(&key)?),
            None => existing.canonical_key.clone(),
        };
        if let Some(key) = canonical_key.as_deref() {
            if let Some(conflict) = Self::active_by_key_tx(
                &mut tx,
                &owner_id,
                existing.scope,
                &existing.scope_owner_id,
                key,
            )
            .await?
            {
                if conflict.id != existing.id {
                    return Err(MemoryError::InvalidMemoryOperation(
                        "another active memory already owns this canonical key".to_string(),
                    ));
                }
            }
        }

        let operation = MemoryOperation {
            operation: MemoryOperationKind::Update,
            memory_id: Some(existing.id.clone()),
            scope: existing.scope,
            scope_owner_id: existing.scope_owner_id.clone(),
            category: input.category.unwrap_or(existing.category),
            canonical_key,
            value: input.value.or_else(|| Some(existing.value.clone())),
            summary: input.summary.or_else(|| Some(existing.summary.clone())),
            confidence: input.confidence.or(Some(existing.confidence)),
            importance: input.importance.or(Some(existing.importance)),
            source_chat_id: existing.source_chat_id.clone(),
            source_message_ids: existing.source_message_ids.clone(),
        };
        Self::update_existing_tx(
            &mut tx,
            &existing,
            &operation,
            operation.canonical_key.as_deref(),
        )
        .await?;
        tx.commit().await?;

        let rows = sqlx::query("SELECT * FROM memory_records WHERE owner_id = ?1 AND id = ?2")
            .bind(owner_id)
            .bind(&input.memory_id)
            .fetch_one(&self.pool)
            .await?;
        row_to_record(rows)
    }

    async fn delete_memory(
        &self,
        owner_id: &str,
        memory_id: &str,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let mut tx = self.pool.begin().await?;
        let existing = Self::record_by_id_tx(&mut tx, &owner_id, memory_id)
            .await?
            .ok_or_else(|| MemoryError::NotFound(memory_id.to_string()))?;
        Self::mark_deleted_tx(&mut tx, &existing.id).await?;
        Self::enqueue_memory_sync_tx(
            &mut tx,
            sync_provider,
            &existing.id,
            MemorySyncOperation::Delete,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn clear_scope(
        &self,
        owner_id: &str,
        scope: MemoryScope,
        scope_owner_id: Option<&str>,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let now = Utc::now().to_rfc3339();
        let rows = if let Some(scope_owner_id) = scope_owner_id {
            sqlx::query("SELECT id FROM memory_records WHERE owner_id = ?1 AND scope = ?2 AND scope_owner_id = ?3 AND deleted_at IS NULL")
                .bind(&owner_id)
                .bind(scope.to_string())
                .bind(scope_owner_id)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query("SELECT id FROM memory_records WHERE owner_id = ?1 AND scope = ?2 AND deleted_at IS NULL")
                .bind(&owner_id)
                .bind(scope.to_string())
                .fetch_all(&self.pool)
                .await?
        };
        let mut tx = self.pool.begin().await?;
        for row in rows {
            let id: String = row.get("id");
            Self::mark_deleted_at_tx(&mut tx, &id, &now).await?;
            Self::enqueue_memory_sync_tx(&mut tx, sync_provider, &id, MemorySyncOperation::Delete)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn clear_all(
        &self,
        owner_id: &str,
        sync_provider: Option<&str>,
    ) -> Result<(), MemoryError> {
        let owner_id = normalize_owner_id(owner_id)?;
        let rows =
            sqlx::query("SELECT id FROM memory_records WHERE owner_id = ?1 AND deleted_at IS NULL")
                .bind(&owner_id)
                .fetch_all(&self.pool)
                .await?;
        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await?;
        for row in rows {
            let id: String = row.get("id");
            Self::mark_deleted_at_tx(&mut tx, &id, &now).await?;
            Self::enqueue_memory_sync_tx(&mut tx, sync_provider, &id, MemorySyncOperation::Delete)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_processing_turn(
        &self,
        turn_id: &str,
    ) -> Result<Option<MemoryProcessingRecord>, MemoryError> {
        let row = sqlx::query("SELECT * FROM memory_processing_queue WHERE turn_id = ?1")
            .bind(turn_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_processing).transpose()
    }

    async fn claim_processing_turn(
        &self,
        turn_id: &str,
    ) -> Result<Option<MemoryProcessingRecord>, MemoryError> {
        let now = Utc::now().to_rfc3339();
        let result = sqlx::query(
            r#"
            UPDATE memory_processing_queue
            SET state = 'processing',
                attempts = attempts + 1,
                last_error = NULL,
                updated_at = ?1,
                completed_at = NULL
            WHERE turn_id = ?2
              AND state IN ('pending', 'failed')
              AND (next_retry_at IS NULL OR next_retry_at <= ?1)
            "#,
        )
        .bind(&now)
        .bind(turn_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Ok(None);
        }

        self.get_processing_turn(turn_id).await
    }

    async fn finish_processing_turn(
        &self,
        turn_id: &str,
        state: ProcessingState,
        message: Option<&str>,
    ) -> Result<MemoryProcessingRecord, MemoryError> {
        if matches!(
            state,
            ProcessingState::Pending | ProcessingState::Processing
        ) {
            return Err(MemoryError::InvalidMemoryOperation(
                "processing turn can only finish as completed, failed, or skipped".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let completed_at = if matches!(state, ProcessingState::Completed | ProcessingState::Skipped)
        {
            Some(now.as_str())
        } else {
            None
        };
        let next_retry_at = if state == ProcessingState::Failed {
            Some((Utc::now() + chrono::Duration::minutes(5)).to_rfc3339())
        } else {
            None
        };

        let result = sqlx::query(
            r#"
            UPDATE memory_processing_queue
            SET state = ?1,
                last_error = ?2,
                next_retry_at = ?3,
                updated_at = ?4,
                completed_at = ?5
            WHERE turn_id = ?6
            "#,
        )
        .bind(state.to_string())
        .bind(message)
        .bind(next_retry_at.as_deref())
        .bind(&now)
        .bind(completed_at)
        .bind(turn_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(MemoryError::NotFound(turn_id.to_string()));
        }

        self.get_processing_turn(turn_id)
            .await?
            .ok_or_else(|| MemoryError::NotFound(turn_id.to_string()))
    }

    async fn enqueue_completed_turn(
        &self,
        input: MemoryCompletedTurnRecordInput,
    ) -> Result<MemoryProcessingRecord, MemoryError> {
        let owner_id = normalize_owner_id(&input.owner_id)?;
        let turn_id = completed_turn_id(
            &input.conversation_id,
            &input.user_message_id,
            &input.assistant_message_id,
        );
        let state = if input.skip_reason.is_some()
            || !is_completed_success(&input)
            || !is_substantive_turn(&input)
        {
            ProcessingState::Skipped
        } else {
            ProcessingState::Pending
        };
        let reason = if let Some(reason) = input.skip_reason.clone() {
            Some(reason)
        } else if !is_completed_success(&input) {
            Some("assistant message was not completed successfully".to_string())
        } else if !is_substantive_turn(&input) {
            Some("turn is empty or non-substantive".to_string())
        } else {
            None
        };
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO memory_processing_queue (
                turn_id, owner_id, conversation_id, user_message_id, assistant_message_id,
                user_scope_owner_id, project_scope_owner_id, chat_scope_owner_id,
                state, last_error, created_at, updated_at,
                completed_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)
            "#,
        )
        .bind(&turn_id)
        .bind(&owner_id)
        .bind(input.conversation_id)
        .bind(input.user_message_id)
        .bind(input.assistant_message_id)
        .bind(input.user_scope_owner_id)
        .bind(input.project_scope_owner_id)
        .bind(input.chat_scope_owner_id)
        .bind(state.to_string())
        .bind(reason)
        .bind(&now)
        .bind(if state == ProcessingState::Skipped {
            Some(now.as_str())
        } else {
            None
        })
        .execute(&self.pool)
        .await?;

        let row = sqlx::query("SELECT * FROM memory_processing_queue WHERE turn_id = ?1")
            .bind(turn_id)
            .fetch_one(&self.pool)
            .await?;
        row_to_processing(row)
    }
}

fn normalize_owner_id(owner_id: &str) -> Result<String, MemoryError> {
    let owner_id = owner_id.trim();
    if owner_id.is_empty() {
        return Err(MemoryError::InvalidMemoryOperation(
            "owner id is required".to_string(),
        ));
    }
    Ok(owner_id.to_string())
}

fn row_to_settings(row: sqlx::sqlite::SqliteRow) -> Result<MemorySettings, MemoryError> {
    Ok(MemorySettings {
        owner_id: row.get("owner_id"),
        enabled: row.get::<bool, _>("enabled"),
        provider: row.get("provider"),
        automatic_extraction: row.get::<bool, _>("automatic_extraction"),
        require_sensitive_confirmation: row.get::<bool, _>("require_sensitive_confirmation"),
        enable_user_memory: row.get::<bool, _>("enable_user_memory"),
        enable_project_memory: row.get::<bool, _>("enable_project_memory"),
        enable_chat_memory: row.get::<bool, _>("enable_chat_memory"),
        allow_temporary_recall: row.get::<bool, _>("allow_temporary_recall"),
        retrieval_limit: row.get("retrieval_limit"),
        token_budget: row.get("token_budget"),
        extraction_provider_id: row.get("extraction_provider_id"),
        extraction_provider: row.get("extraction_provider"),
        extraction_model: row.get("extraction_model"),
        extraction_api_base_url: row.get("extraction_api_base_url"),
        embedding_provider_id: row.get("embedding_provider_id"),
        embedding_provider: row.get("embedding_provider"),
        embedding_model: row.get("embedding_model"),
        embedding_api_base_url: row.get("embedding_api_base_url"),
        mem0_endpoint: row.get("mem0_endpoint"),
        locality: row.get("locality"),
    })
}

fn row_to_record(row: sqlx::sqlite::SqliteRow) -> Result<MemoryRecord, MemoryError> {
    let scope: String = row.get("scope");
    let category: String = row.get("category");
    let value_json: String = row.get("value_json");
    let source_message_ids: String = row.get("source_message_ids");
    Ok(MemoryRecord {
        id: row.get("id"),
        owner_id: row.get("owner_id"),
        scope: scope.parse().map_err(MemoryError::InvalidMemoryOperation)?,
        scope_owner_id: row.get("scope_owner_id"),
        category: category
            .parse()
            .map_err(MemoryError::InvalidMemoryOperation)?,
        canonical_key: row.get("canonical_key"),
        value: serde_json::from_str(&value_json)?,
        summary: row.get("summary"),
        confidence: row.get::<f64, _>("confidence") as f32,
        importance: row.get::<f64, _>("importance") as f32,
        source_chat_id: row.get("source_chat_id"),
        source_message_ids: serde_json::from_str(&source_message_ids).unwrap_or_default(),
        valid_from: parse_dt(row.get("valid_from"))?,
        valid_until: parse_dt(row.get("valid_until"))?,
        supersedes_id: row.get("supersedes_id"),
        is_active: row.get::<bool, _>("is_active"),
        deleted_at: parse_dt(row.get("deleted_at"))?,
        sync_status: row.get("sync_status"),
        sync_error: row.get("sync_error"),
        created_at: parse_required_dt(row.get("created_at"))?,
        updated_at: parse_required_dt(row.get("updated_at"))?,
        last_used_at: parse_dt(row.get("last_used_at"))?,
    })
}

fn row_to_processing(row: sqlx::sqlite::SqliteRow) -> Result<MemoryProcessingRecord, MemoryError> {
    let state: String = row.get("state");
    Ok(MemoryProcessingRecord {
        turn_id: row.get("turn_id"),
        owner_id: row.get("owner_id"),
        conversation_id: row.get("conversation_id"),
        user_message_id: row.get("user_message_id"),
        assistant_message_id: row.get("assistant_message_id"),
        state: state.parse().map_err(MemoryError::InvalidMemoryOperation)?,
        attempts: row.get("attempts"),
        last_error: row.get("last_error"),
        created_at: parse_required_dt(row.get("created_at"))?,
        updated_at: parse_required_dt(row.get("updated_at"))?,
        completed_at: parse_dt(row.get("completed_at"))?,
    })
}

fn parse_dt(value: Option<String>) -> Result<Option<DateTime<Utc>>, MemoryError> {
    value
        .map(|value| parse_required_dt(Some(value)))
        .transpose()
}

fn parse_required_dt(value: Option<String>) -> Result<DateTime<Utc>, MemoryError> {
    let value =
        value.ok_or_else(|| MemoryError::StorageFailure("missing timestamp".to_string()))?;
    if let Ok(parsed) = DateTime::parse_from_rfc3339(&value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    let parsed = NaiveDateTime::parse_from_str(&value, "%Y-%m-%d %H:%M:%S")
        .map_err(|error| MemoryError::StorageFailure(error.to_string()))?;
    Ok(DateTime::<Utc>::from_naive_utc_and_offset(parsed, Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::types::{MemoryCategory, MemoryScopeOwner};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn repo() -> SqliteMemoryRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../db/migrations/20260616000000_create_memory_tables.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        SqliteMemoryRepository::new(pool)
    }

    fn op(
        kind: MemoryOperationKind,
        key: &str,
        value: &str,
        scope: MemoryScope,
    ) -> MemoryOperation {
        MemoryOperation {
            operation: kind,
            memory_id: None,
            scope,
            scope_owner_id: match scope {
                MemoryScope::User => "user-1",
                MemoryScope::Project => "project-1",
                MemoryScope::Chat => "chat-1",
            }
            .to_string(),
            category: MemoryCategory::Preference,
            canonical_key: Some(key.to_string()),
            value: Some(json!(value)),
            summary: Some(value.to_string()),
            confidence: Some(0.9),
            importance: Some(0.8),
            source_chat_id: Some("chat-1".to_string()),
            source_message_ids: vec!["msg-1".to_string()],
        }
    }

    #[tokio::test]
    async fn canonical_add_then_update_keeps_single_active_record() {
        let repo = repo().await;
        repo.apply_operations(
            "user-1",
            vec![op(
                MemoryOperationKind::Add,
                "identity.preferred_name",
                "Big T",
                MemoryScope::User,
            )],
            None,
        )
        .await
        .unwrap();
        repo.apply_operations(
            "user-1",
            vec![op(
                MemoryOperationKind::Add,
                "identity.preferred_name",
                "Theo",
                MemoryScope::User,
            )],
            None,
        )
        .await
        .unwrap();
        let records = repo
            .list(MemoryListQuery {
                owner_id: "user-1".to_string(),
                scope: Some(MemoryScope::User),
                scope_owner_id: Some("user-1".to_string()),
                category: None,
                include_inactive: false,
                include_deleted: false,
                include_superseded: false,
                limit: None,
                offset: None,
            })
            .await
            .unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].value, json!("Theo"));
    }

    #[tokio::test]
    async fn supersede_marks_old_record_inactive() {
        let repo = repo().await;
        repo.apply_operations(
            "user-1",
            vec![op(
                MemoryOperationKind::Add,
                "identity.preferred_name",
                "Big T",
                MemoryScope::User,
            )],
            None,
        )
        .await
        .unwrap();
        repo.apply_operations(
            "user-1",
            vec![op(
                MemoryOperationKind::Supersede,
                "identity.preferred_name",
                "Theo",
                MemoryScope::User,
            )],
            None,
        )
        .await
        .unwrap();
        let active = repo
            .recall(MemoryRecallQuery {
                owner_id: "user-1".to_string(),
                query: String::new(),
                scopes: vec![MemoryScopeOwner {
                    scope: MemoryScope::User,
                    scope_owner_id: "user-1".to_string(),
                }],
                limit: 10,
                token_budget: 600,
            })
            .await
            .unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].value, json!("Theo"));

        let all = repo
            .list(MemoryListQuery {
                owner_id: "user-1".to_string(),
                scope: Some(MemoryScope::User),
                scope_owner_id: Some("user-1".to_string()),
                category: None,
                include_inactive: true,
                include_deleted: false,
                include_superseded: true,
                limit: None,
                offset: None,
            })
            .await
            .unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all.iter().filter(|record| record.is_active).count(), 1);
    }

    #[tokio::test]
    async fn scope_isolation_keeps_same_key_separate() {
        let repo = repo().await;
        repo.apply_operations(
            "user-1",
            vec![
                op(
                    MemoryOperationKind::Add,
                    "preference.package_manager",
                    "Bun",
                    MemoryScope::User,
                ),
                op(
                    MemoryOperationKind::Add,
                    "preference.package_manager",
                    "Cargo",
                    MemoryScope::Project,
                ),
            ],
            None,
        )
        .await
        .unwrap();
        let user = repo
            .recall(MemoryRecallQuery {
                owner_id: "user-1".to_string(),
                query: String::new(),
                scopes: vec![MemoryScopeOwner {
                    scope: MemoryScope::User,
                    scope_owner_id: "user-1".to_string(),
                }],
                limit: 10,
                token_budget: 600,
            })
            .await
            .unwrap();
        assert_eq!(user.len(), 1);
        assert_eq!(user[0].value, json!("Bun"));
    }

    #[tokio::test]
    async fn delete_removes_from_recall() {
        let repo = repo().await;
        repo.apply_operations(
            "user-1",
            vec![op(
                MemoryOperationKind::Add,
                "identity.preferred_name",
                "Big T",
                MemoryScope::User,
            )],
            None,
        )
        .await
        .unwrap();
        repo.apply_operations(
            "user-1",
            vec![MemoryOperation {
                operation: MemoryOperationKind::Delete,
                value: None,
                summary: None,
                ..op(
                    MemoryOperationKind::Delete,
                    "identity.preferred_name",
                    "",
                    MemoryScope::User,
                )
            }],
            None,
        )
        .await
        .unwrap();
        let active = repo
            .recall(MemoryRecallQuery {
                owner_id: "user-1".to_string(),
                query: String::new(),
                scopes: vec![MemoryScopeOwner {
                    scope: MemoryScope::User,
                    scope_owner_id: "user-1".to_string(),
                }],
                limit: 10,
                token_budget: 600,
            })
            .await
            .unwrap();
        assert!(active.is_empty());
    }

    #[tokio::test]
    async fn completed_turn_queue_is_idempotent_and_skips_temporary() {
        let repo = repo().await;
        let input = MemoryCompletedTurnRecordInput {
            owner_id: "user-1".to_string(),
            conversation_id: "chat-1".to_string(),
            user_message_id: "u1".to_string(),
            assistant_message_id: "a1".to_string(),
            user_scope_owner_id: Some("user-1".to_string()),
            project_scope_owner_id: None,
            chat_scope_owner_id: Some("chat-1".to_string()),
            skip_reason: Some("temporary chats do not run automatic memory extraction".to_string()),
            user_content: "Remember my preference".to_string(),
            assistant_content: "Done".to_string(),
            assistant_status: Some("complete".to_string()),
        };
        let first = repo.enqueue_completed_turn(input.clone()).await.unwrap();
        let second = repo.enqueue_completed_turn(input).await.unwrap();
        assert_eq!(first.turn_id, second.turn_id);
        assert_eq!(first.state, ProcessingState::Skipped);
        assert_eq!(second.state, ProcessingState::Skipped);
    }

    #[tokio::test]
    async fn processing_turn_can_be_claimed_and_completed_once() {
        let repo = repo().await;
        let input = MemoryCompletedTurnRecordInput {
            owner_id: "user-1".to_string(),
            conversation_id: "chat-1".to_string(),
            user_message_id: "u1".to_string(),
            assistant_message_id: "a1".to_string(),
            user_scope_owner_id: Some("user-1".to_string()),
            project_scope_owner_id: None,
            chat_scope_owner_id: Some("chat-1".to_string()),
            skip_reason: None,
            user_content: "My name is Theo".to_string(),
            assistant_content: "Got it".to_string(),
            assistant_status: Some("complete".to_string()),
        };
        let queued = repo.enqueue_completed_turn(input).await.unwrap();
        assert_eq!(queued.state, ProcessingState::Pending);

        let claimed = repo
            .claim_processing_turn(&queued.turn_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claimed.state, ProcessingState::Processing);
        assert_eq!(claimed.attempts, 1);

        let duplicate_claim = repo.claim_processing_turn(&queued.turn_id).await.unwrap();
        assert!(duplicate_claim.is_none());

        let completed = repo
            .finish_processing_turn(&queued.turn_id, ProcessingState::Completed, None)
            .await
            .unwrap();
        assert_eq!(completed.state, ProcessingState::Completed);
        assert!(completed.completed_at.is_some());
    }
}
