# Poly UI Persistent Memory Design

## Scope

Poly UI owns canonical memory state in local SQLite. External systems such as Mem0 are optional retrieval/indexing adapters only. Phase 1 implements native local foundations: schema, Rust domain, canonical operations, scope isolation, processing idempotency, sensitive filtering, sync outbox, typed commands, and unit tests. Memory remains disabled by default and is not wired into chat generation until Phase 2.

## Database Schema

Add `20260616000000_create_memory_tables.sql`:

- `memory_settings`: one row per owner/profile. Stores enablement, scope toggles, provider names, budgets, extraction settings, locality hints, and non-secret config references.
- `memory_records`: canonical local records. Contains owner id, scope, category, canonical key, JSON value, summary, confidence, importance, source chat, source message ids, validity, supersedes id, active/deleted flags, timestamps, last used time, and sync status.
- `memory_processing_queue`: durable completed-turn records keyed by `turn_id`. States: `pending`, `processing`, `completed`, `failed`, `skipped`. Stores user message id, assistant message id, conversation id, owner ids, failure reason, attempts, timestamps. Unique `turn_id` prevents duplicate extraction.
- `memory_outbox`: local sync outbox. Operations: `UPSERT`, `DELETE`, `REINDEX`. Stores provider, local memory id, payload JSON, attempts, last error, next retry, created/completed timestamps.
- `memory_record_sources`: optional normalized provenance table for source message ids where UI needs indexed lookups.

Canonical active constraint: one active non-deleted record per `(owner_id, scope, scope_owner_id, canonical_key)` when `canonical_key` is present. Superseded rows remain queryable but are excluded from recall by default.

## Rust Modules And Traits

Add `src-tauri/src/memory/`:

- `mod.rs`: exports domain and service types.
- `types.rs`: `MemoryRecord`, `MemoryScope`, `MemoryCategory`, `MemoryOperation`, `MemoryOperationResult`, `MemorySettings`, query/update DTOs.
- `error.rs`: typed `MemoryError` variants: provider unavailable, invalid endpoint, auth failure, unsupported model, structured output failure, embedding failure, storage failure, timeout, invalid operation, scope mismatch, sensitive data rejected.
- `repository.rs`: `MemoryRepository` trait plus SQLite implementation.
- `canonical.rs`: ADD, UPDATE, SUPERSEDE, DELETE, NOOP transaction rules.
- `filter.rs`: deterministic sensitive-data filter and redaction.
- `extractor.rs`: `MemoryExtractor` trait and `NoopMemoryExtractor` for Phase 1.
- `retriever.rs`: `MemoryRetriever` trait and local SQLite retriever.
- `context.rs`: `MemoryContextBuilder` trait and safe `<poly_memory>` formatter contract for Phase 2.
- `processing.rs`: durable queue helpers, turn id construction, state transitions.
- `sync.rs`: `MemorySyncProvider` trait, disabled sync provider, outbox enqueue helpers.
- `service.rs`: orchestration facade used by commands and later chat lifecycle.

Add `src-tauri/src/commands/memory_commands.rs` with narrow typed commands:

- `memory_get_settings`
- `memory_update_settings`
- `memory_test_connection`
- `memory_list`
- `memory_search`
- `memory_update`
- `memory_delete`
- `memory_clear_scope`
- `memory_clear_all`
- `memory_remember_message`
- `memory_forget_message`
- `memory_get_related`
- `memory_enqueue_completed_turn`

Phase 1 commands call local repository/service only. Provider-specific request execution is not exposed to frontend.

## Extraction Lifecycle

Phase 2 lifecycle:

1. Assistant stream completes successfully.
2. Assistant message is persisted.
3. Frontend may call `memory_enqueue_completed_turn` with stable message ids only.
4. Rust validates feature/settings, conversation existence, status, temporary-chat policy, deleted-chat absence, substantive content, and idempotency.
5. Rust creates or reuses queue row.
6. Background processor moves `pending -> processing`.
7. Sensitive filter redacts or rejects unsafe content.
8. Extractor returns structured operations.
9. Canonical transaction applies operations.
10. Outbox sync is queued after local commit.
11. Queue row becomes `completed`, `failed`, or `skipped`.

React lifetime never decides whether extraction is valid. Duplicate frontend invokes hit the unique `turn_id` and become no-ops.

## Recall Lifecycle

Phase 2 recall occurs in Rust before `ToolLoop::run`:

1. Resolve active scopes from owner ids: user profile, project/folder, chat, agent config.
2. Retrieve candidates from canonical local records first.
3. Filter inactive, deleted, superseded, wrong-scope, expired, and low-confidence records.
4. Rank by relevance, importance, confidence, and recency.
5. Apply strict token budget.
6. Format as `<poly_memory>` untrusted user context, never instructions.
7. Append to existing system prompt without changing provider behavior.

Mem0 in Phase 4 may return candidate IDs only. Poly UI resolves them back to local records before injection.

## Canonical Merge Rules

- `ADD` with no canonical key inserts active record.
- `ADD` with canonical key inserts if no active record exists; otherwise becomes `UPDATE` unless the new value conflicts and operation is explicit `SUPERSEDE`.
- `UPDATE` modifies the active canonical row in place and appends provenance.
- `SUPERSEDE` marks existing active canonical row inactive with `valid_until`, inserts new active row with `supersedes_id`, and queues `DELETE` or `UPSERT` outbox work for external indexes.
- `DELETE` marks active canonical row deleted/inactive and queues external delete.
- `NOOP` records operation result only; no memory row changes.

Recall returns only active, non-deleted, non-expired records. One active canonical preference cannot coexist with another active value for the same owner, scope, scope owner, and canonical key.

## Idempotency

`turn_id = conversation_id:user_message_id:assistant_message_id`. `memory_processing_queue.turn_id` is unique. Commands use `INSERT OR IGNORE`; existing `completed`, `processing`, or `skipped` rows are not duplicated. `failed` rows may be retried by explicit command or later worker policy.

## Mem0 Outbox Sync

Phase 1 creates provider-independent outbox records but uses disabled sync. Phase 4 adds `Mem0MemorySyncProvider`.

Outbox operations:

- `UPSERT`: mirror active canonical record into external index.
- `DELETE`: remove external index entry for deleted/superseded record.
- `REINDEX`: rebuild provider state from local active records.

Outbox writes happen after canonical local transaction. Sync failure updates attempt count, last error, next retry time with bounded exponential backoff, and leaves canonical local memory intact.

## Scope Ownership

- `User`: `scope_owner_id = profile_id`.
- `Project`: `scope_owner_id = folder_id` or future project id.
- `Chat`: `scope_owner_id = conversation_id`.
- `Agent`: `scope_owner_id = agent configuration id`.

Scope is explicit in every record and query. Project memory is not promoted to user memory without an explicit operation. Agent workspace selection is not project memory.

## Temporary Chats

Default: no automatic persistent extraction from temporary chats. Temporary chats do not read chat-scoped memory from other conversations. Temporary recall of user/project memory is disabled unless settings explicitly allow it. Explicit "Remember this" can write memory after Rust validation. Deleting temporary chats clears related processing rows.

## Error Handling

Memory errors are typed and non-fatal to chat. Commands return actionable messages without secrets. Processing failures set queue/outbox state and are visible to UI. Memory disabled mode leaves chat behavior unchanged.

## Security Boundaries

Sensitive-data filtering runs before extractor or external sync. It rejects or redacts passwords, API keys, auth tokens, cookies, payment/bank data, exact private addresses, private keys, recovery phrases, and likely secrets from code/env content. Stored memories are untrusted text; context builder labels them as user context, not instructions. API keys are never logged or returned in full.

## Files To Add Or Modify

Phase 1:

- Add `docs/superpowers/specs/2026-06-16-poly-ui-memory-design.md`
- Add `src-tauri/src/db/migrations/20260616000000_create_memory_tables.sql`
- Add `src-tauri/src/memory/mod.rs`
- Add `src-tauri/src/memory/types.rs`
- Add `src-tauri/src/memory/error.rs`
- Add `src-tauri/src/memory/filter.rs`
- Add `src-tauri/src/memory/canonical.rs`
- Add `src-tauri/src/memory/repository.rs`
- Add `src-tauri/src/memory/extractor.rs`
- Add `src-tauri/src/memory/retriever.rs`
- Add `src-tauri/src/memory/context.rs`
- Add `src-tauri/src/memory/processing.rs`
- Add `src-tauri/src/memory/sync.rs`
- Add `src-tauri/src/memory/service.rs`
- Add `src-tauri/src/commands/memory_commands.rs`
- Modify `src-tauri/src/commands/mod.rs`
- Modify `src-tauri/src/lib.rs`
- Modify `src-tauri/src/error.rs` only if shared error conversion is useful.

Later phases:

- `src-tauri/src/commands/chat_commands.rs`
- AI SDK sidecar runtime if context injection needs helper contract changes
- `src/features/chat/hooks/useChatStream.ts` only to submit stable completed-turn ids after persistence
- Settings and memory UI files under `src/components/Settings/` and `src/features/memory/`
- Docs under `docs/memory.md`
