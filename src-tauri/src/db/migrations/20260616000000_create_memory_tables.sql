CREATE TABLE IF NOT EXISTS memory_settings (
    owner_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'disabled',
    automatic_extraction INTEGER NOT NULL DEFAULT 0,
    require_sensitive_confirmation INTEGER NOT NULL DEFAULT 1,
    enable_user_memory INTEGER NOT NULL DEFAULT 1,
    enable_project_memory INTEGER NOT NULL DEFAULT 1,
    enable_chat_memory INTEGER NOT NULL DEFAULT 1,
    allow_temporary_recall INTEGER NOT NULL DEFAULT 0,
    retrieval_limit INTEGER NOT NULL DEFAULT 8,
    token_budget INTEGER NOT NULL DEFAULT 600,
    extraction_provider_id INTEGER,
    extraction_provider TEXT,
    extraction_model TEXT,
    extraction_api_base_url TEXT,
    embedding_provider_id INTEGER,
    embedding_provider TEXT,
    embedding_model TEXT,
    embedding_api_base_url TEXT,
    mem0_endpoint TEXT,
    locality TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_records (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    scope_owner_id TEXT NOT NULL,
    category TEXT NOT NULL,
    canonical_key TEXT,
    value_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.75,
    importance REAL NOT NULL DEFAULT 0.5,
    source_chat_id TEXT,
    source_message_ids TEXT NOT NULL DEFAULT '[]',
    valid_from TEXT,
    valid_until TEXT,
    supersedes_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'local',
    sync_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (supersedes_id) REFERENCES memory_records(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_records_active_canonical
ON memory_records(owner_id, scope, scope_owner_id, canonical_key)
WHERE canonical_key IS NOT NULL
  AND is_active = 1
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_records_scope
ON memory_records(owner_id, scope, scope_owner_id, is_active, deleted_at);

CREATE INDEX IF NOT EXISTS idx_memory_records_category
ON memory_records(owner_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_memory_records_updated
ON memory_records(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_record_sources (
    memory_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    chat_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (memory_id, message_id),
    FOREIGN KEY (memory_id) REFERENCES memory_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_record_sources_message
ON memory_record_sources(message_id);

CREATE TABLE IF NOT EXISTS memory_processing_queue (
    turn_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    user_message_id TEXT NOT NULL,
    assistant_message_id TEXT NOT NULL,
    user_scope_owner_id TEXT,
    project_scope_owner_id TEXT,
    chat_scope_owner_id TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_processing_queue_state
ON memory_processing_queue(state, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_memory_processing_queue_conversation
ON memory_processing_queue(conversation_id);

CREATE TABLE IF NOT EXISTS memory_outbox (
    id TEXT PRIMARY KEY,
    local_memory_id TEXT,
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (local_memory_id) REFERENCES memory_records(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_outbox_pending
ON memory_outbox(provider, completed_at, next_retry_at);
