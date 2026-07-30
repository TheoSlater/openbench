# Poly UI runtime rework — checkpoint 1 audit and design

Produced 2026-07-27 against `main` @ `9b4484b`. No application code was changed.

This document is the source of truth for file paths, existing names, and current behavior for checkpoints 2–8.

---

# Part 1 — audit of the current codebase

## 1. Provider registry and provider types

**There is no registry.** Providers are a closed Rust enum plus a match-based factory. Adding a provider means editing six files.

| Concern | Location |
| --- | --- |
| Provider enum | `src-tauri/src/providers/base.rs` → `enum ProviderType { OllamaLocal, OpenAICompatible, AnthropicNative, GeminiNative }` (derives `sqlx::Type`, so the enum name is the literal stored in SQLite) |
| Status enum | `src-tauri/src/providers/base.rs` → `enum ProviderStatus { Online, Offline, Reconnecting, Unavailable }` |
| Row type | `src-tauri/src/providers/base.rs` → `struct ProviderConfig` (`sqlx::FromRow`, 13 fields) |
| Traits | `src-tauri/src/providers/base.rs` → `trait ChatProvider`, `trait ModelCatalog`, `trait LocalModelManager: ModelCatalog` |
| Construction | `src-tauri/src/providers/factory.rs` → `ProviderFactory::create_chat_provider`, `::create_model_catalog`, `::create_local_model_manager` |
| Config normalization | `src-tauri/src/providers/profile.rs` → `struct ProviderProfile`, `ProviderProfile::from_config` |
| Selection / health | `src-tauri/src/providers/selector.rs` → `struct ProviderSelector` |
| Implementations | `providers/ollama.rs` (439 L), `providers/openai_compatible.rs` (967 L), `providers/anthropic.rs` (635 L), `providers/gemini.rs` (604 L) |
| Frontend mirror | `src/features/providers/index.ts` → hand-written `type ProviderType`, `interface ProviderConfig`, `interface ProviderStatusResponse` |
| Frontend presets | `src/features/providers/presets.ts` → `PROVIDER_PRESETS`, `lookupPreset`, `type ProviderKind` |
| Label map | `src/store/modelStore.ts` → `providerLabels: Record<ModelProvider, string>` |

**Provider-specific conditionals live in seven places:**

1. `providers/factory.rs` — three separate `match profile.provider_type` arms (one per factory method), each near-identical.
2. `providers/profile.rs` — two `match config.provider_type` blocks: default endpoint, and which column holds the key (`ollama_api_key` vs `api_key`).
3. `db/connection.rs:41` — hardcoded `DELETE FROM provider_configs WHERE provider_type NOT IN (...)` string.
4. `db/connection.rs:51-124` — `ensure_default_provider_configs`, four copy-pasted `INSERT ... WHERE NOT EXISTS` blocks.
5. `commands/provider_commands.rs` → `should_preload_models` — a `matches!` that currently returns `true` for every variant (dead branch).
6. `src/features/settings/tabs/ConnectionsTab.tsx` → `KIND_TO_PROVIDER_TYPE`, `presetIcons`, `isOllamaLocal`.
7. `src/lib/models/model-choice.ts:35` and `src/lib/models/model-selector.ts` — hardcoded `"OllamaLocal" | "OpenAICompatible"` string literal checks. **These two are already stale**: `AnthropicNative` and `GeminiNative` are absent, so `parseModelChoiceId` returns `null` for any Anthropic or Gemini model id (see §6).

`ProviderType` is `Copy + Eq + Hash`, which the health cache and selector rely on.

## 2. Secret storage

**Nothing is OS-backed. Every secret is plaintext.**

| Secret | Where it lives | Reaches SQLite | Reaches logs | Reaches frontend state |
| --- | --- | --- | --- | --- |
| Provider API key | `provider_configs.api_key` TEXT, `provider_configs.ollama_api_key` TEXT | **Yes**, plaintext | No | **Yes** |
| Web-search API keys (exa, ollama, tavily) | `localStorage["polyui:settings"]` → `general.webSearch.apiKeys` | No | No | **Yes**, persisted |
| Session token | `localStorage["session_token"]` | `sessions.token` (plaintext) | No | Yes |
| Password | `users.passwordHash` — bcrypt, correct | Hashed | No | No |

Details:

- Schema: `src-tauri/src/db/migrations/20260509000000_create_provider_configs.sql` — `api_key TEXT`, `ollama_api_key TEXT`, `headers TEXT` (arbitrary JSON, may contain `Authorization`).
- **Keys round-trip to React.** `get_providers` (`commands/provider_commands.rs`) serializes the whole `ProviderConfig`, including `api_key`, into `ProviderStatusResponse`. `useProviderStore` (`src/features/providers/index.ts`) holds it in Zustand memory. `ConnectionsTab.tsx:124` copies it into a `useState` and renders it into a `TextField`. The provider store is **not** persisted, so keys do not survive reload in localStorage — but they are in the renderer heap and in any devtools/heap snapshot.
- **Web-search keys are persisted to localStorage.** `src/store/settingsStore.ts` `partialize` includes `general`, and `general.webSearch.apiKeys` is inside it (`createDefaultWebSearchSettings`). Written via `createSafeJsonStorage` in `src/store/persistStorage.ts`. This is a direct violation of the shared context's "never store secrets in `localStorage`, in Zustand persistence".
- `update_provider_config` binds `api_key` directly (`providers/selector.rs:258`). No redaction anywhere.
- No `keyring`, `tauri-plugin-stronghold`, or equivalent in `src-tauri/Cargo.toml`.

## 3. Chat request path

```
ChatInput (send)
 └─ useChatStream.sendMessage                     src/features/chat/hooks/useChatStream.ts:402
    ├─ validModelChoices(modelChoices)            :36
    ├─ guard: useOllamaStore.state !== "online" → abort  :407
    ├─ chatStore.actions.addMessage (user)        src/store/chatStore.ts:292 → repository INSERT
    ├─ extractUserMessageMemory (fire-and-forget) :49  → invoke("memory_extract_user_message")
    └─ startStream(conversationId, models)        :273
       ├─ history = store messages OR getRepository().getMessages(cid, 50, 0)
       ├─ getWebSearchConfig()                    src/features/web-search/useWebSearchConfig.ts
       ├─ buildSystemPrompt(...)                  src/lib/chat/prompts.ts
       └─ for each ModelChoice:  (parallel, not awaited)
          ├─ crypto.randomUUID() ×2 → requestId, messageId
          ├─ session.register({requestId, messageId, conversationId})
          ├─ chatStore.actions.setStreamingMessage(mid, placeholder)
          └─ invoke("chat_stream", { requestId, conversationId, model, messages,
                systemPrompt, webSearchConfig, reasoningEnabled, providerType,
                providerConfigId, accountId, token })
```

Rust side:

```
chat_stream                                       src-tauri/src/commands/chat_commands.rs:37
 ├─ check_account → auth::authorize_account        src-tauri/src/auth.rs
 ├─ my_generation_id = state.current_generation_id.load(SeqCst)
 ├─ provider_selector.get_provider_by_config_id(type, id, account)   providers/selector.rs:177
 │   └─ get_provider_configs → SELECT … → ProviderFactory::create_chat_provider
 │      (falls back to ::get_provider by type when providerConfigId is null)
 ├─ MemoryService::new(db).build_context_for_chat(...)  src-tauri/src/memory/service.rs
 ├─ append_memory_context(system_prompt, memory_context)  :119
 ├─ TauriStreamEmitter::new(app_handle)            src-tauri/src/stream_emitter.rs
 ├─ create_web_search_client(config)               src-tauri/src/web_search/mod.rs
 └─ ToolLoop::run(provider, model, messages, …, is_cancelled)  src-tauri/src/tool_loop.rs:173
    └─ provider.chat_completion(...) → reqwest → HTTP leaves the process
       (providers/openai_compatible.rs | anthropic.rs | gemini.rs | ollama.rs)
```

Tauri commands involved: `chat_stream` (streaming path), `cancel_chat`, plus `chat` and `generate_chat_title` (non-streaming, used only by title generation — `src/lib/chat/title-generation.ts`).

## 4. Streaming

Three Tauri events, all app-global (no per-window, no per-request channel).

| Event name | Rust payload type | Emitted by |
| --- | --- | --- |
| `chat-chunk` | `models::chat::StreamPayload` | `TauriStreamEmitter::emit_chunk` |
| `chat-thinking` | `models::chat::ThinkingPayload` | `TauriStreamEmitter::emit_thinking` |
| `web-search-event` | `models::chat::WebSearchEvent` | `TauriStreamEmitter::emit_web_search` |
| `pull-progress` | `models::chat::PullProgressPayload` | `commands/model_commands.rs::pull_model` (direct `app_handle.emit`, bypasses the emitter trait) |

Payload shapes (`src-tauri/src/models/chat.rs`):

```rust
StreamPayload  { request_id, content, thinking: Option<String>, done: bool,
                 metadata: Option<StreamMetadata>, tool_calls: Option<Vec<ToolCallInfo>>,
                 error: Option<String> }
ThinkingPayload{ request_id, thinking: String, is_thinking: bool }
WebSearchEvent { request_id, query, status: String, results: Option<Vec<SearchResultItem>> }
StreamMetadata { prompt_eval_count, eval_count, total_duration, load_duration,
                 prompt_eval_duration, eval_duration, model }
```

Frontend mirror is **hand-written** in `src/lib/chat/stream-client.ts` (`ChunkPayload`, `ThinkingPayload`, `WebSearchPayload`) and again, partially, in `src/types/chat.ts` (`StreamPayload`, `WebSearchEvent`). Three copies of the same shape, no generation.

**Where parsing happens — four layers:**

1. **Provider SSE parsing (Rust)** — each provider parses its own wire format into `StreamPayload`. `providers/openai_compatible.rs` (967 L) has the largest; `anthropic.rs` handles `message_start`/`content_block_delta`/`message_delta`/`message_stop`; `gemini.rs` handles its own JSON stream; `ollama.rs` uses `ollama-rs`.
2. **`<think>` tag parsing (Rust)** — `tool_loop.rs::ThinkingTagParser`, `THINK_START_TAGS = ["<think>", "<|channel>thought"]`, `THINK_END_TAGS = ["</think>", "<channel|>"]`. Buffers across chunk boundaries, `safe_split_index` guards UTF-8. Non-trivial and correct; keep.
3. **Event delivery (TS)** — `src/lib/chat/stream-client.ts` `TauriEventBus` (`subscribe`/`unsubscribe`, `EventBus` interface as test seam); `src/lib/chat/event-bus.ts` re-exports it plus a `StreamEventBus` **singleton** used by `useChatStream`.
4. **Accumulation (TS)** — `src/lib/chat/stream-session.ts` `StreamSession` maps `request_id → messageId/conversationId`, tracks thinking start/end times, counts `pendingStreams`; `src/lib/chat/stream-accumulator.ts` `StreamAccumulator` batches token updates and flushes on `requestAnimationFrame`.

Semantics worth recording: **content chunks are deltas, thinking events are the full accumulated string** (`tool_loop.rs:269` comment, honoured at `stream-session.ts:97` "replace, don't append"). This is deliberately O(n²) over IPC and self-healing.

## 5. Conversation database schema

One file, `src-tauri/src/db/migrations/*.sql` for sqlx-managed tables, plus imperative `CREATE TABLE IF NOT EXISTS` for the chat tables in `db/connection.rs`. Both run against the same DB: `app_config_dir()/chat.db`.

**`conversations`** — created imperatively, `db/connection.rs::ensure_conversations_schema`:

| Column | Type | Used? |
| --- | --- | --- |
| `id` | TEXT PK | yes |
| `title` | TEXT | yes |
| `createdAt` | TEXT | yes |
| `updatedAt` | TEXT | yes |
| `isArchived` | INTEGER DEFAULT 0 | yes |
| `userId` | TEXT DEFAULT '' | yes |
| `folderId` | TEXT | yes |
| `metadata` | TEXT (JSON `ConversationMetadata`) | partially — `activeFeatureIds` and `surfaces` are declared in `src/types/chat.ts` but `surfaces` has no remaining writer after the browser-viewport removal |

Not persisted despite existing on the TS `Conversation` type: `isTemporary`, `titleSource`, `titleGeneratedAt`, `titleGenerationStatus`. These are in-memory only — **title provenance is lost on reload**.

**`messages`** — same file:

| Column | Type | Used? |
| --- | --- | --- |
| `id`, `conversationId`, `role`, `content`, `createdAt` | TEXT | yes |
| `attachments` | TEXT (JSON) | yes |
| `model` | TEXT | yes |
| `provider` | TEXT | yes — stores the `ProviderType` *name* only, **not** `provider_config_id` |
| `thinking`, `thinkingDuration` | TEXT / REAL | yes |
| `webSearch` | TEXT (JSON) | yes |
| `status`, `errorMessage` | TEXT | yes |
| `memoryUpdates` | TEXT (JSON) | yes — though `src/types/chat.ts:68` still claims "In-memory only, not persisted", which is now wrong |

**Indexes:** `idx_messages_conversation(conversationId)`, `idx_messages_created(createdAt)`, `idx_conversations_updated(updatedAt)`, `idx_conversations_archived(isArchived)`, `idx_conversations_user(userId)`, `idx_folders_user(userId)`.

**Missing index:** `deleteMessagesAfter` and `getMessages` both filter `conversationId` then sort `createdAt`; there is no composite `(conversationId, createdAt)`.

**No foreign keys** between `messages` and `conversations`, despite `foreign_keys(true)` on the pool. Deletion is manual two-statement (`repositories/index.ts:43`).

Other tables: `folders`, `users`, `sessions`, `provider_configs`, `memory_settings`, `memory_records`, `memory_record_sources`, `memory_processing_queue`, `memory_outbox`.

## 6. Selected-model persistence

- **Runtime state**: `src/store/modelStore.ts` → `selectedModel`, `selectedProvider`, `selectedModels[]`, `selectedProviders[]`, `selectedModelChoices: ModelChoice[]`. **Not persisted at all** — lost on every reload.
- **The saved default**: `localStorage["default_model"]`, read once at store creation (`modelStore.ts:90`), written by `actions.setDefaultModel`. A raw string, not part of the Zustand persist layer.
- **Encoding**: `src/lib/models/model-choice.ts` → `modelChoiceId(provider, model, providerConfigId)` produces `Provider:model` or `Provider:configId:model` (model percent-encoded). `parseModelChoiceId` is the inverse.
- **Restoration**: `src/hooks/useAutoSelectModel.ts` runs on mount, `findDefaultModelChoice(models, defaultModel)` (`model-choice.ts:57`), falling back to `models[0]`.

**What happens when the stored default no longer resolves:**

1. `findDefaultModelChoice` returns `undefined` → falls back to `models[0]`, silently. No notice to the user, and `default_model` in localStorage is **not** rewritten, so the stale value is retried on every launch.
2. **Bug, present today:** `parseModelChoiceId` hardcodes `if (provider !== "OllamaLocal" && provider !== "OpenAICompatible") return null` (`model-choice.ts:35`). Any default saved for `AnthropicNative` or `GeminiNative` fails to parse, falls through to the legacy `models.find(m => m.name === storedDefault)` branch — which cannot match, because the stored value is `"AnthropicNative:claude-…"`, not a bare model name. The Anthropic/Gemini default is therefore **always** ignored.
3. `useAutoSelectModel` has the same hardcoded literal: `parsedDefault?.provider === "OpenAICompatible"` gates external-model loading, so an Anthropic default never triggers the external load either.
4. `filterModelOptions` (`model-selector.ts:19`) maps `"external"` to `OpenAICompatible` only — Anthropic and Gemini models are invisible under the External filter.
5. If `providerConfigId` points at a deleted row, `chat_stream` → `get_provider_by_config_id` returns `Err("Provider configuration {id} is unavailable.")`, surfaced as a red error message per model (`useChatStream.ts:336`).

## 7. Tauri command surface

Registered in `src-tauri/src/lib.rs:202-270`. Provider / model / chat scoped:

| Command | Module | Async | Blocking work |
| --- | --- | --- | --- |
| `chat_stream` | `commands/chat_commands.rs:37` | async | No — but holds `tauri::State` across the whole stream |
| `chat` | `commands/chat_commands.rs:152` | async | No |
| `generate_chat_title` | `commands/chat_commands.rs:186` | async | No |
| `cancel_chat` | `commands/config_commands.rs:5` | **sync** | Trivial (`fetch_add`), acceptable |
| `get_providers` | `commands/provider_commands.rs:96` | async | Network: health-checks every provider, 10 s timeout each |
| `get_provider_and_models` | `commands/provider_commands.rs:120` | async | **Yes, serial.** Health-check all, then `try_preload_models` per provider **sequentially awaited** in a `for` loop, 10 s timeout each. N offline providers ⇒ up to N×10 s. |
| `get_provider_models` | `commands/provider_commands.rs:157` | async | Same serial pattern |
| `update_provider_config` | `commands/provider_commands.rs:203` | async | No |
| `add_provider` | `commands/provider_commands.rs:249` | async | No |
| `delete_provider` | `commands/provider_commands.rs:277` | async | No |
| `get_local_models` | `commands/model_commands.rs:8` | async | Network |
| `pull_model` | `commands/model_commands.rs:36` | async | Long-running; emits `pull-progress` |
| `delete_model` | `commands/model_commands.rs:24` | async | Network |
| `cancel_pull` | `commands/model_commands.rs:78` | **sync** | Trivial |
| `restart_app` | `lib.rs:82` | sync | Uses `run_on_main_thread`, correct |
| `pty_spawn`/`pty_write`/`pty_resize`/`pty_close` | `src-tauri/src/pty.rs` | **all sync** | `pty_spawn` does `openpty` + `spawn_command` on the invoke thread; `pty_write` takes a `std::sync::Mutex` |

**Removed Poly Agent commands: none remain.** `agent_process_commands.rs`, `agent_mcp_server.rs`, `agent_viewport.rs` are all gone; no `agent`-prefixed command is registered.

Also present but out of scope: `auth::*` (7), `memory_commands::*` (16), `dictation_commands::*` (12), `updater::*` (3), `mobile_pairing_*` (3), startup logging (4), `execute_sql`, `clear_database` (feature-gated `dev-sql-console`).

**`execute_sql` is registered unconditionally** (`lib.rs:240`) — only `clear_database` is behind the `dev-sql-console` cfg. This contradicts the claim in `AGENTS.md`.

## 8. Frontend state stores

`src/store/`, plus two feature-local stores. **Stores never import each other**; cross-store effects go through `src/store/coordinator.ts`.

| Store | File | Persisted | Key / scope |
| --- | --- | --- | --- |
| `useModelStore` | `store/modelStore.ts` | **No** except `defaultModel` | `localStorage["default_model"]`, hand-rolled |
| `useProviderStore` | `features/providers/index.ts` | **No** | in-memory; holds `api_key` |
| `useChatStore` | `store/chatStore.ts` | **No** | conversations/messages live in SQLite via the repository |
| `useSettingsStore` | `store/settingsStore.ts` | **Yes** | `localStorage["polyui:settings"]`, version 26, `partialize: {general, tts, dictation, performance, selectedPromptPreset}` — **`general.webSearch.apiKeys` is inside this** |
| `useAuthStore` | `store/authStore.ts` | partial | `localStorage["session_token"]`, guest id |
| `useFolderStore` | `store/folderStore.ts` | No | SQLite |
| `useThemeStore` | `store/themeStore.ts` | Yes | `localStorage["theme_mode"]` |
| `useTtsStore`, `useUpdateStore`, `useNotificationStore`, `useConfirmStore`, `useDevStore` | `store/*.ts` | No | — |
| `useViewportStore` | `features/viewport/viewportStore.ts` | partial | `localStorage` width key |
| `useOllamaStore` | `features/ollama/monitor.ts` | No | health-monitor gate used by `sendMessage` |

Coordinator wiring relevant to this rework (`store/coordinator.ts`): auth id change → `refreshProviders()` → `useChatStore.loadConversations()` → `useFolderStore.loadFolders()`.

Persistence helper: `src/store/persistStorage.ts::createSafeJsonStorage` — quarantines corrupt payloads via `backupCorruptStorageItem`. Good, keep.

## 9. Cancellation

One mechanism, global, for the entire app:

```rust
// AppState, src-tauri/src/lib.rs:46
pub current_generation_id: AtomicUsize,

// commands/config_commands.rs
pub fn cancel_chat(state) { state.current_generation_id.fetch_add(1, SeqCst); }
```

`chat_stream` snapshots `my_generation_id` at entry and passes a closure `|| current != my_generation_id` into `ToolLoop::run`, which checks it **once per received chunk** (`tool_loop.rs:226`).

**What leaks / breaks:**

1. **Cancellation is not per-request.** `cancel_chat` takes no `request_id`. In a multi-model turn, cancelling one cancels all. Cancelling conversation A cancels an in-flight stream in conversation B.
2. **Nothing is aborted, only ignored.** The reqwest stream is not dropped on cancel; the loop returns `Err(AppError::Cancelled)` at the *next* chunk. A model that stalls after cancel keeps its HTTP connection and tokio task alive until the provider closes it. Tokens continue to be generated and billed.
3. **`ToolLoop` mid-tool leaks.** If cancelled during the web-search call, `client.search(...)` is not cancellable — it completes, then the check fires.
4. **No cancellation for the non-streaming paths.** `chat`, `generate_chat_title`, `get_provider_and_models`, `pull_model` (has its own separate `is_pull_cancelled: AtomicBool`, same design flaw).
5. **Frontend double-settle is handled.** `StreamSession::finish` is idempotent (`stream-session.ts:151`), and `stopStreaming` (`useChatStream.ts:444`) sets `cancelRef` and `session.cancel()` before awaiting `cancel_chat`. This part is correct.
6. **Subscription leak on the singleton.** `useChatStream` subscribes via the module-level `streamEventBus` singleton (`event-bus.ts:31`) and calls `unsubscribe()` in its cleanup. Two mounted consumers of `useChatStream` would have the second `subscribe` silently no-op (guard at `stream-client.ts:50`) and the first unmount would tear down listeners for both. Currently only one consumer exists, so it does not bite — but it is a latent hazard for the ACP UI.

## 10. Migrations

**Two mechanisms, running in sequence, in `db/connection.rs::init_db`:**

**(a) Imperative bootstrap** — `ensure_conversations_schema`, `ensure_folders_schema`. `CREATE TABLE IF NOT EXISTS` + per-column `pragma_table_info` probe + `ALTER TABLE ADD COLUMN`. Idempotent by construction. Untracked — no version, no ledger. Covers `conversations`, `messages`, `folders`.

**(b) sqlx migrator** — `sqlx::migrate!("./src/db/migrations")`, ledger in `_sqlx_migrations`. Six files, current version **`20260616000000`**:

| Version | File | Idempotent |
| --- | --- | --- |
| 20260501000000 | `create_users.sql` | yes (`IF NOT EXISTS`) |
| 20260501001000 | `recreate_sessions_integer_user_id.sql` | yes (`DROP IF EXISTS` + `CREATE`) — but destructive; drops all sessions |
| 20260509000000 | `create_provider_configs.sql` | yes (`IF NOT EXISTS`, `INSERT OR IGNORE`) |
| 20260510000000 | `remove_ollama_api.sql` | yes (`DELETE WHERE`) |
| 20260531000000 | `add_openai_compatible_provider.sql` | **`SELECT 1;` — an empty no-op migration**, kept only to hold its ledger slot |
| 20260616000000 | `create_memory_tables.sql` | yes |

**(c) Checksum repair** — `fix_migration_checksums_from_dir` runs **before** the migrator and rewrites `_sqlx_migrations.checksum` to match whatever is on disk. It reads from `env!("CARGO_MANIFEST_DIR")`, so in a shipped build the directory does not exist and the function early-returns (there is a test for exactly this: `checksum_repair_skips_missing_source_migration_dir`). In dev it silently accepts edited applied migrations. This is a deliberate dev-ergonomics escape hatch that also disables sqlx's tamper detection.

**(d) Post-migration data mutation** — `init_db` runs `DELETE FROM provider_configs WHERE provider_type NOT IN (...)` (`connection.rs:41`) on **every startup**, outside any migration. A provider row whose type is not in the hardcoded list is deleted without warning. Then `ensure_default_provider_configs(&pool, "")` re-seeds four rows for the empty account.

**Retry wrapper**: `lib.rs::init_db_with_retry` — 5 attempts, `tauri::async_runtime::block_on` on the setup thread, 200/400/600/800 ms backoff.

---

## Remaining Poly Agent code

**None found.** Searched `src/`, `src-tauri/src/`, and the command registry for `poly.agent`, `polyAgent`, `poly_agent`, `agent_loop`, `agentMode`, `agentStore`, `features/agent`, `agent_mcp_server`, `agent_viewport`. Zero hits. `src/features/agent/` does not exist. Removal (commits `6514b2f`, `4a484ba`, `7cab170`) was complete on both sides.

Three residues, none of them code:

1. **`AGENTS.md` is stale.** Its feature list still names `agent` under `src/features/`, and it claims `execute_sql` is gated behind `dev-sql-console` — it is not (see §7).
2. **Two orphaned npm dependencies** in `package.json`: `ai` (^7.0.8) and `@ai-sdk/openai-compatible` (^3.0.2). Zero imports across `src/` and `tests/`. These were the Poly Agent runtime.
3. `docs/superpowers/plans/2026-07-23-remove-poly-agent.md` — the removal plan, historical.

## Reusable executable-resolution and process-spawning code

**Executable resolution: none exists.** No `which`-equivalent, no PATH scan, no version probing, no `Command::new(...).arg("--version")` health check. Nothing to reuse for adapter detection. `dirs = "6"` is available (`home_dir`, used in `pty.rs:63` and `startup_log.rs:111`).

**Process spawning — three existing sites, none directly reusable:**

| Site | Mechanism | Reusable for ACP? |
| --- | --- | --- |
| `src-tauri/src/pty.rs` | `portable-pty` `CommandBuilder` + `native_pty_system().openpty()`. Owns `PtyState { HashMap<String, PtySession> }` behind a `std::sync::Mutex`, holds a `Box<dyn ChildKiller>`, spawns an OS thread per session to pump the reader into a `tauri::ipc::Channel<PtyEvent>`. Kills the child if the channel send fails. | **Not for the ACP transport** — ACP needs clean piped stdio, and a PTY would mangle framing and merge stderr into stdout, violating "ACP protocol messages come from stdout only". **But strongly reusable for adapter terminal-auth** (see Part 3), which is exactly a "run this command in a terminal the user can see" flow. |
| `src-tauri/src/updater.rs:395-447` | `std::process::Command` for the installer/`chmod`/`sh` | No |
| `src-tauri/src/commands/dictation_commands.rs` | Whisper model download via `reqwest` streaming + `app_data_dir()` layout | Only as a pattern for a future "install the adapter" progress flow |

Both `pty_spawn` and `pty_close` already avoid shell string concatenation and use a killer handle. `PtyState` is a reasonable structural precedent for an ACP session registry, but it uses a **blocking `std::sync::Mutex` inside sync Tauri commands** — do not copy that part.

## ts-rs

**`ts-rs` is not in the project at all.** Not in `src-tauri/Cargo.toml` (build-deps or deps), no `#[derive(TS)]` anywhere in `src-tauri/src/`, no `#[ts(export)]`, no `bindings/` output directory. `src/generated/` contains exactly one file, `releaseNotes.json`, produced by `scripts/generate-release-notes.mjs` — unrelated.

It is neither wired into the build nor run manually. The removal plan (`2026-07-23-remove-poly-agent.md`, Task 1) deleted `scripts/sync-agent-types.mjs`, which was the Poly Agent-era type sync — so whatever generation existed went out with Poly Agent.

**This contradicts the shared context**, which states as fact: "Types cross the Rust and TypeScript boundary through `ts-rs`." Today every cross-boundary type is hand-mirrored — `ProviderType`/`ProviderConfig`/`ProviderStatusResponse` in `src/features/providers/index.ts`, the three stream payloads in `src/lib/chat/stream-client.ts`, and a partial third copy in `src/types/chat.ts`. Checkpoint 2 must **introduce** `ts-rs`, not extend it.

---

# Part 2 — assessment

## Weak abstractions that must be replaced, not extended

| Abstraction | Why it cannot be extended |
| --- | --- |
| `ProviderType` enum (`providers/base.rs`) | It is simultaneously a Rust type, a **SQLite string literal** (via `sqlx::Type`), a TypeScript union, a filter discriminant, and a component of the `default_model` id string. Every one of those is an exhaustive match or a hardcoded literal list. Adding a runtime family is not "one more variant" — the ACP runtimes are not `ChatProvider`s at all, and the shared context explicitly forbids merging them. Needs replacing with a connection row keyed on a stable id, plus a separate tagged runtime reference. |
| `ProviderFactory` (`providers/factory.rs`) | Three near-identical `match` blocks over the same enum, each re-running `ProviderProfile::from_config`. It is a switch statement wearing a struct. It also cannot express "this connection has no chat capability" other than by returning `None`, which callers turn into the misleading string `"provider is disabled."` |
| `ProviderConfig` row shape | 13 columns of which 5 (`ollama_host`, `ollama_api_key`, `ollama_api_base_url`, `api_key`, `api_base_url`) encode "which field means what" as a function of `provider_type`, resolved in `ProviderProfile::from_config`. It cannot represent a coding-agent installation, a workspace, or a secret reference. |
| `modelChoiceId` / `parseModelChoiceId` (`src/lib/models/model-choice.ts`) | A string-concatenated composite key with a hardcoded provider allowlist that is **already wrong** (§6). The runtime reference must be a structured, Rust-owned tagged union, not a delimited string parsed in TypeScript. |
| `ProviderSelector::get_active_provider*` | "Pick the first enabled, online provider by priority" is dead weight — the chat path always passes an explicit `provider_type` + `provider_config_id`. `get_active_provider`, `get_active_provider_type`, and the `active_provider: Arc<TokioMutex<Option<ProviderType>>>` field exist to serve a fallback that no longer runs. |
| `StreamPayload` as the single event type | One flat struct carrying content, thinking, tool calls, metadata, error, and a `done` flag, with `Option` for everything. ACP produces session updates, plan updates, permission requests, terminal output, and diffs — none of which fit. Needs a proper Rust enum per runtime family. |
| The global `streamEventBus` singleton (`src/lib/chat/event-bus.ts`) | Module-level singleton with a "first subscriber wins" guard. A second consumer (the ACP activity UI) cannot subscribe. `TauriEventBus` — the class it wraps — is fine; the singleton wrapper is not. |

## Duplicated request, streaming, and error handling

- **SSE/stream parsing ×4** — `openai_compatible.rs` (967 L), `anthropic.rs` (635 L), `gemini.rs` (604 L), `ollama.rs` (439 L). Each hand-rolls chunk framing, delta accumulation, tool-call assembly, and error mapping into `StreamPayload`. ~2 600 lines with substantial structural overlap. **In scope for checkpoint 6 only** — do not touch in 2–5.
- **`ProviderFactory` ×3** — `create_chat_provider` and `create_model_catalog` have byte-identical match arms.
- **`ensure_default_provider_configs` ×4** — four copy-pasted `INSERT … SELECT … WHERE NOT EXISTS` blocks differing only in literals.
- **Provider refresh ×4** — `useProviderStore.actions` re-invokes `get_providers` at the end of `updateProviderConfig`, `addProvider`, and `deleteProvider`, and `updateProviderConfig` additionally invokes `get_providers` *first* to read the current row. Each of those is a full health-check sweep of every provider. Updating one toggle can trigger two sweeps.
- **Cross-boundary type mirrors ×3** — §4 and the ts-rs section above.
- **`check_account` / `map_auth_err` ×2** — identical private copies in `chat_commands.rs:15-33` and `provider_commands.rs:6-26`.
- **Error handling** — Rust is `Result<_, String>` everywhere at the command boundary; `AppError` (`src-tauri/src/error.rs`) exists with seven variants but is `#[allow(dead_code)]` and mostly stringified immediately (`.map_err(|e| AppError::Db(e).to_string())`). Structured errors never reach TypeScript, which does `typeof err === "string" ? err : (err as Error).message` (`useChatStream.ts:337`).

## Unsafe

| # | Issue | Location |
| --- | --- | --- |
| 1 | **Provider API keys stored plaintext in SQLite** | `provider_configs.api_key`, `.ollama_api_key`, `.headers` |
| 2 | **Web-search API keys persisted plaintext in `localStorage`** | `settingsStore.ts` partialize → `general.webSearch.apiKeys` |
| 3 | **API keys returned to the frontend and held in Zustand** | `get_providers` → `ProviderStatusResponse.config.api_key` → `useProviderStore` → `ConnectionsTab.tsx:124` |
| 4 | **Session tokens stored plaintext** in `sessions.token` and `localStorage["session_token"]` | `migrations/…_recreate_sessions_integer_user_id.sql`, `authStore.ts:60` |
| 5 | **`execute_sql` registered unconditionally** — arbitrary SQL from the renderer against the app DB | `lib.rs:240` |
| 6 | **`fs:scope allow: ["**"]`** — unrestricted filesystem read/write from the webview | `src-tauri/capabilities/default.json` |
| 7 | **Blocking `std::sync::Mutex` held inside sync Tauri commands** — `pty_write`/`pty_resize`/`pty_close`/`pty_spawn` run on the invoke thread; `pty_spawn` also does `openpty` + `spawn_command` there | `src-tauri/src/pty.rs` |
| 8 | **Serial network fan-out in a command** — `get_provider_and_models` awaits each provider's model list in a `for` loop with a 10 s timeout each | `provider_commands.rs:120` |
| 9 | **Cancellation cancels everything, and aborts nothing** — see §9 items 1–4 | `lib.rs:46`, `tool_loop.rs:226` |
| 10 | **Migration checksum verification is defeated in dev** | `db/connection.rs::fix_migration_checksums_from_dir` |
| 11 | **Unconditional destructive delete on every startup** — `DELETE FROM provider_configs WHERE provider_type NOT IN (…)` | `db/connection.rs:41` |
| 12 | **`StreamAccumulator` has no bound.** `pending`, `content`, `thinking` are `Record<string, string>` that grow with the full response text; `content` is re-copied on every chunk (`stream-session.ts:64`), giving O(n²) memory traffic per stream. Bounded in practice by response length, not by policy. | `stream-accumulator.ts` |
| 13 | **Latent subscription leak** — singleton event bus, first-subscriber-wins, shared unsubscribe | `event-bus.ts:31` |
| 14 | **`process::exit` on `ExitRequested`** — deliberate and documented (`lib.rs:284`), safe for SQLite today, but it means **no destructor runs**. Any ACP child process must be killed *before* this point or it is orphaned. | `lib.rs:282-293` |

Items 4, 5, 6, and 14 are pre-existing and out of scope for this rework; recorded so they are not mistaken for regressions introduced by it. Item 14 is a hard constraint on checkpoint 3.

## Working code to preserve as-is

This list exists to stop unnecessary rewrites. Each of these is correct, tested, or load-bearing.

**Rust**

- `src-tauri/src/tool_loop.rs::ThinkingTagParser` — cross-chunk tag buffering with UTF-8-safe splitting (`safe_split_index`, `find_first_tag`). Subtle and correct. Keep verbatim.
- `src-tauri/src/stream_emitter.rs` — the `StreamEmitter` trait + `TauriStreamEmitter` + `test::TestStreamEmitter` spy. The right seam, already proven. **Extend with new methods; do not replace.**
- `src-tauri/src/providers/{ollama,openai_compatible,anthropic,gemini}.rs` — the actual HTTP/SSE request logic. Duplicated (above), but working against four real APIs. Checkpoint 6 may consolidate; checkpoints 2–5 must not touch them.
- `src-tauri/src/db/connection.rs::fix_migration_checksums_from_dir` — the missing-dir early return is deliberate and has a regression test.
- `src-tauri/src/memory/**` — entirely orthogonal. Do not touch.
- `src-tauri/src/web_search/**` — the `WebSearchClient` trait + Exa/Tavily/Ollama/local impls + mock. Good shape.
- `src-tauri/src/lib.rs` `ExitRequested` handler and its `ponytail:` comment — a hard-won Linux shutdown fix. Do not "clean up".
- `src-tauri/src/startup_log.rs` and the `log_phase` calls threaded through `lib.rs`/`connection.rs` — the only diagnostic for release-build startup failures.
- `src-tauri/src/pty.rs::validate_pty_size` and the structured `CommandBuilder` usage.

**TypeScript**

- `src/lib/chat/stream-accumulator.ts` — rAF batching, partial `reset(requestIds)` semantics for sibling streams, `dispose()`. Comments document non-obvious invariants.
- `src/lib/chat/stream-session.ts` — `request_id → messageId` mapping, idempotent `finish()`, thinking start/end timing. Reusable for ACP with a different payload type.
- `src/lib/chat/stream-client.ts` — `EventBus` interface + `TauriEventBus`. Keep the class; retire only the `StreamEventBus` singleton in `event-bus.ts`.
- `src/lib/repositories/` — `ConversationRepository` interface, SQLite impl, `InMemoryConversationRepository`, `setRepository()` injection seam. The whole test suite depends on it.
- `src/store/persistStorage.ts::createSafeJsonStorage` — corrupt-payload quarantine.
- `src/store/coordinator.ts` — the no-cross-store-imports rule and its single wiring point.
- `src/store/settingsStore.ts::mergeSettingsWithDefaults` + the version-26 migrate chain — self-healing rehydrate; adding a settings key needs no migration.
- `src/features/chat/hooks/useChatStream.ts` queue handling — `processNextInQueue`, `processingQueueRef` reentrancy guard, cross-conversation starvation fallback (`store.messageQueue[0]`). Fiddly, comment-documented.
- `src/features/ollama/health-monitor.ts` + `monitor.ts` — the online gate `sendMessage` depends on.
- All 37 files in `tests/` — in particular `tests/noMixedDynamicImports.test.ts`, `tests/sidebarTokenDiscipline.test.ts`, `tests/persistStorage.test.ts`, `tests/modelChoice.test.ts`.

---

# Part 3 — external verification

Verified 2026-07-27 against crates.io, docs.rs, the npm registry, and each project's own repository. **Read the discrepancy table at the end of this part before writing any code.**

## `agent-client-protocol` — version to pin

**Pin `agent-client-protocol = "=2.0.0"`. Released 2026-07-23.**

Release history (crates.io):

| Version | Released |
| --- | --- |
| **2.0.0** | **2026-07-23** |
| 1.3.0 | 2026-07-20 |
| 1.2.0 | 2026-07-07 |
| 1.1.0 | 2026-07-06 |
| 1.0.1 | 2026-06-29 |
| 1.0.0 | 2026-06-24 |

**The 2.0 migration does not apply to us.** It is a 1.x→2.0 guide (`md/migration_v2.0.md` in the SDK repo) and Poly UI has no ACP code to migrate. We start on 2.0.0 directly. The guide is still worth reading once, because it documents the shape we are building against: notifications can no longer receive error responses (`send_error_notification` and `Dispatch::respond_with_error` are gone; match on `Dispatch::{Request, Notification, Response}` or omit the catch-all entirely), `Channel` now carries `TransportFrame` rather than `Result<RawJsonRpcMessage, Error>`, and — most relevant — **`AcpAgent` gained an SDK-owned process-launch configuration instead of reusing an MCP wire-schema type**. That last change is what makes the companion process crate unnecessary (below).

Edition 2024, `rust-version = 1.88.0`. Poly UI's crate is edition 2021 — mixing is fine, but the toolchain must be ≥ 1.88.

**Wire protocol version is separate and must not be inferred from the crate version.** The Claude adapter's README refers to "ACP 1.2" for its own capability negotiation; the crate exposes `ProtocolVersion::V1` in its connection examples and has an `unstable_protocol_v2` feature. Negotiate via `initialize` and branch on the returned `protocolVersion`, exactly as the shared context instructs.

**Feature flags matter more than expected.** `default = []`, and the surfaces both adapters actually use are behind opt-in features:

| Feature | Needed for |
| --- | --- |
| `unstable_auth_methods` | The `authMethods` array both adapters return from `initialize` — **required for checkpoints 4 and 5** |
| `unstable_llm_providers` | The Claude adapter's `providers/list` / `providers/set` / `providers/disable` |
| `unstable_session_fork` | `sessionCapabilities.fork` (both adapters advertise it) |
| `unstable_elicitation` | Adapter elicitation prompts (both adapters ship elicitation handlers) |
| `unstable_end_turn_token_usage` | Token usage reporting at end of turn |
| `unstable_mcp_over_acp`, `unstable_plan_operations`, `unstable_tool_call_name` | Not needed yet |

`unstable` is an umbrella enabling the first eight. Checkpoint 2 should enable at minimum `unstable_auth_methods`; checkpoints 4–5 will need more. These forward to `agent-client-protocol-schema`, so the schema crate's own feature set is what actually gates the types.

## Send-ness of connection and handler types — **and what it means**

**Everything is `Send`. This is the answer that shapes the ACP host.**

Verified directly in `src/agent-client-protocol/src/jsonrpc.rs` on `main`:

```rust
pub trait HandleDispatchFrom<Counterpart: Role>: Send { … }
    fn …(…) -> impl Future<Output = Result<Handled<Dispatch>, crate::Error>> + Send;

pub trait ConnectionContext: connection_context::Sealed + Send + Sync + 'static {
    type Connection<Counterpart: Role>: Clone + Send + Sync + 'static;
}
```

and every handler-registration bound on `ConnectionTo` (`on_receiving_result`, the `on_request_*` family, `spawn`) carries `+ Send`. `ConnectionTo<Counterpart>` itself is documented as `Send + Sync`, `'static`, and cheaply `Clone` — "all copies reference the same underlying connection, facilitating sharing across async tasks."

**Implications for a Tauri-managed ACP host:**

1. **No `LocalSet`, no `spawn_local`, no dedicated single-threaded runtime.** This is the opposite of the historical Zed `agent-client-protocol` crate, which was `Rc`-based and `!Send` and forced a dedicated thread. The design constraint that motivated most of the original plan's complexity **does not exist**. Do not build a thread-confined actor to work around it.
2. **Tauri's default multi-threaded Tokio runtime is directly usable.** `tauri::async_runtime::spawn` is fine.
3. **A cloned `ConnectionTo` can live in `tauri::State`** — `Clone + Send + Sync + 'static` satisfies Tauri's managed-state bound. That means Tauri commands can send requests on a live connection without going through a channel.
4. **But the connection's *lifetime* is scope-bound, not value-bound.** The 2.0 API is a scoped closure:
   ```rust
   Client.builder()
       .name("poly-ui")
       .connect_with(transport, async |cx| { /* cx: ConnectionTo<Agent> */ Ok(()) })
       .await?;
   ```
   The dispatch loop runs for as long as that future runs. You cannot construct a connection, return it, and store it. The host must therefore be: **one long-lived `tauri::async_runtime::spawn`ed task per agent process, which enters `connect_with` and parks; inside the closure it publishes a clone of `cx` into shared state and then awaits a shutdown signal.** Commands take the clone out of state and use it. That is the shape, and it is a consequence of the closure API — not of `Send`.
5. `connect_with` vs `connect_to` is a real decision: `connect_to` returns `Ok(())` on clean incoming EOF (reactive); `connect_with` fails pending requests on EOF but does not cancel unrelated work in the closure (foreground-owned). **For a host that owns the child process, `connect_with` is correct** — an adapter crash must not silently resolve as success.

**One caveat that is not about `Send`:** the core crate's non-wasm dependencies are `async-io`, `async-process`, and `blocking` — the smol ecosystem, **not** Tokio. Tokio appears only as a dev-dependency. The SDK therefore starts its own `async-io` reactor thread alongside Tauri's Tokio runtime. This works (the futures are runtime-agnostic and `async-io` self-drives), but it means one extra reactor thread in the process and that `tokio::time`/`tokio::fs` cannot be assumed available inside SDK-driven callbacks. Use `futures` primitives inside handlers.

## Companion crates — which are actually needed

| Crate | Latest | Verdict |
| --- | --- | --- |
| `agent-client-protocol` | **2.0.0** (2026-07-23) | **Required.** Pin exact. |
| `agent-client-protocol-tokio` | 0.11.1 (**2026-04-21**) | **Do not use.** See below. |
| `agent-client-protocol-schema` | 1.6.0 (2026-07-21) | **Do not depend on directly.** It is a transitive dependency of the core crate on a *separate version line* (1.x while core is 2.x). Core re-exports what is needed; adding it directly risks a duplicate-version split of the schema types. Feature flags reach it through the core crate's forwarding features. |
| `agent-client-protocol-rmcp` | 3.0.0 (2026-07-23) | **Not needed.** Client-provided MCP servers are out of scope for checkpoints 2–8; both adapters bring their own tools. 3.x is correct-by-design (both `agent-client-protocol` and `rmcp` are public deps in its API), not a version mismatch. |
| `agent-client-protocol-derive` | 2.0.0 | **Not directly.** Transitive via core. |
| `agent-client-protocol-cookbook` | 2.0.0 | **Not a dependency** — it is documentation. Read `https://docs.rs/agent-client-protocol-cookbook`. |
| `agent-client-protocol-conductor` | 2.0.0 | Not needed. Proxy/interception chains are out of scope. |
| `agent-client-protocol-http` | 2.0.0 | Not needed. Both adapters are stdio. |
| `agent-client-protocol-polyfill` | 2.0.0 | Possibly relevant later if an older-protocol agent must be supported. Not for checkpoints 3–5. |
| `agent-client-protocol-test` | **unpublished** | Would be the natural mock-agent source, but it exists only as a workspace member with no version and is not on crates.io. **Checkpoint 3's mock agent must be built in-repo** (or pulled by git rev, which conflicts with "pin an exact version"). Recommend in-repo. |
| `agent-client-protocol-trace-viewer` | 2.0.0 | Dev tool. Optional. |

**`agent-client-protocol-tokio` is dead — and the shared context's instruction to use it is stale.** Two independent confirmations:

1. Its latest release is **0.11.1, 2026-04-21**, three months old, and it depends on `agent-client-protocol ^0.11.1`. It is version-incompatible with 2.0.0 and cannot be used alongside it.
2. It **is no longer a member of the SDK workspace.** The current `Cargo.toml` on `main` lists 11 members — `agent-client-protocol`, `-derive`, `-polyfill`, `-rmcp`, `-conductor`, `-http`, `-test`, `-trace-viewer`, `yopo`, `-cookbook` — and `-tokio` is not among them. The `migration_v2.0.md` coordinated-release table does not list it either.

**Its functionality moved into the core crate.** `agent-client-protocol` 2.0.0 exports, from `src/acp_agent.rs` and `src/stdio.rs`:

- `AcpAgentConfig` — `new(command)`, `.arg()`, `.args()`, `.env()`, `.envs()`, with `command(): &Path`, `arguments(): &[String]`, `environment(): &BTreeMap<String, String>`. **Structured executable path + argument array, no shell string concatenation** — satisfies the global constraint by construction.
- `AcpAgent` — `new(config)`, `.with_debug(cb)`, `.spawn_process()`, plus **`AcpAgent::claude_agent()`** (`npx -y @agentclientprotocol/claude-agent-acp@latest`) and **`AcpAgent::codex()`** (`npx -y @agentclientprotocol/codex-acp@latest`).
- `Stdio`, `ByteStreams`, `Lines` — transports.
- `LineDirection { Stdin, Stdout, Stderr }` for debug tracing.

`spawn_process` pipes stdin/stdout/stderr separately (stderr never touches the protocol path), sets `process_group(0)` on Unix so the whole tree can be killed — with an explicit comment that `npx`/`uvx` wrappers otherwise orphan the real agent — and sets `CREATE_NO_WINDOW` on Windows. Shutdown uses `rustix::process::kill_process_group(pid, SIGKILL)` via a `ChildGuard`, with a `SHUTDOWN_GRACE_PERIOD` and a bounded stderr tail (`STDERR_CAPTURE_LIMIT`, truncation marker) surfaced in the exit error.

**Conclusion: do not write `acp/process.rs`, and do not add `agent-client-protocol-tokio`.** The core crate covers process launch, process-group teardown, stdio transport, and bounded stderr diagnostics. The right answer is the shared context's, for a different reason than it gives.

**Caveat for checkpoint 3:** `process_group(0)` is `#[cfg(unix)]` only. On Windows there is no Job Object, so killing the `npx` wrapper may orphan the real adapter. Combined with Poly UI's `std::process::exit` on `ExitRequested` (§14 above, `lib.rs:282`), **Windows shutdown is the highest-risk orphan path** and needs an explicit kill before the exit handler runs.

## Adapter versions and documented authentication

### Codex — `@agentclientprotocol/codex-acp`

**Current: `1.1.7`, published 2026-07-22.** (`beta` dist-tag: `0.0.40` — ignore.) Recent: 1.1.5 (07-21), 1.1.4 (07-15), 1.1.2/1.1.1 (07-09), 1.1.0 (07-02), 1.0.2 (06-29).

`bin: { "codex-acp": "dist/index.js" }`. Bundles `@openai/codex ^0.145.0` as a dependency, plus `@agentclientprotocol/sdk ^1.3.0`, `vscode-jsonrpc`, `open`, `diff`, `zod`. No `engines` field.

**Authentication, read from `src/CodexAuthMethod.ts`** (not from the README, which omits half of this):

```ts
export function getCodexAuthMethods(clientCapabilities?, env = process.env): AuthMethod[] {
    const authMethods: AuthMethod[] = [ApiKeyAuthMethod];          // always
    if (!env["NO_BROWSER"]) authMethods.push(ChatGptAuthMethod);   // hidden by NO_BROWSER
    if (clientCapabilities?.auth?._meta?.["gateway"] === true)
        authMethods.push(GatewayAuthMethod);                       // opt-in
    return authMethods;
}
```

| Method id | Name | How the credential is supplied |
| --- | --- | --- |
| `api-key` | API Key | **In the `authenticate` request itself**: `_meta["api-key"].apiKey`. Env fallbacks `CODEX_API_KEY` then `OPENAI_API_KEY` also exist (`CODEX_API_KEY_ENV_VAR`, `OPENAI_API_KEY_ENV_VAR`). `_meta["api-key"].provider === "openai"`. |
| `chat-gpt` | ChatGPT | Browser login. Suppressed when `NO_BROWSER` is set. |
| `gateway` | Custom model gateway | `_meta["gateway"] = { baseUrl, headers, providerName? }`. Only offered if the client advertises `clientCapabilities.auth._meta.gateway === true`. `_meta.gateway.restartRequired: "false"`. |

**The `_meta["api-key"].apiKey` request path is the important correction** — the shared context describes only the env-var route. Passing the key in the `authenticate` request is strictly better for us: it never has to enter the child's environment block, which keeps it out of `/proc/<pid>/environ` and out of any process listing.

`CODEX_PATH` points the adapter at a different Codex binary than the bundled one (README).

### Claude — `@agentclientprotocol/claude-agent-acp`

**Current: `0.63.0`, published 2026-07-27 (today).** Recent: 0.62.0 (07-24), 0.61.0 (07-22), 0.60.0 (07-20), 0.59.0 (07-13). **Release cadence is roughly every 2–3 days** — pin exactly and expect drift.

`bin: { "claude-agent-acp": "dist/index.js" }`. **`engines: { node: ">=22" }`.** Dependencies: `@agentclientprotocol/sdk 1.3.0` (exact), `@anthropic-ai/claude-agent-sdk 0.3.220` (exact), `zod`.

**Authentication, read from `src/acp-agent.ts`** — this is materially different from the shared context:

The adapter advertises **terminal-type auth methods**, not env-var-only auth:

```ts
const claudeLoginMethod: AuthMethod = {
  description: "Use Claude subscription ",
  name: "Claude Subscription",
  id: "claude-ai-login",
  type: "terminal",
  args: ["--cli", "auth", "login", "--claudeai"],
};
const consoleLoginMethod: AuthMethod = {
  description: "Use Anthropic Console (API usage billing)",
  name: "Anthropic Console",
  id: "console-login",
  type: "terminal",
  args: ["--cli", "auth", "login", "--console"],
};
```

Both are gated on the client advertising terminal capability:

```ts
const supportsTerminalAuth     = request.clientCapabilities?.auth?.terminal === true;
const supportsMetaTerminalAuth = request.clientCapabilities?._meta?.["terminal-auth"] === true;
if (!shouldHideClaudeAuth() && (supportsTerminalAuth || supportsMetaTerminalAuth))
    terminalAuthMethods.push(…);
```

`shouldHideClaudeAuth()` is simply `process.argv.includes("--hide-claude-auth")`. When that flag *is* passed and the account turns out to be subscription-based, session creation throws `RequestError.authRequired(…, "This integration does not support using claude.ai subscriptions.")` — so the restriction is opt-in by the host, not inherent.

A gateway method pair (`gateway`, `gateway-bedrock`) is offered when `supportsGatewayAuth`; `authenticate()` handles only those two and throws `"Method not implemented."` for anything else — because the terminal methods complete out-of-band in the terminal, not via `authenticate`.

Credential env vars still route the backend (`PROVIDER_ROUTING_ENV_VARS`): `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and friends.

**So: Claude subscription login is genuinely supported at 0.63.0**, contrary to the shared context. It requires Poly UI to implement ACP terminal capability — spawn a visible terminal running `process.execPath` with the given `args`. **Poly UI already has that primitive**: `src-tauri/src/pty.rs` + `src/features/viewport/components/NativeTerminalViewport.tsx`. This is the single largest piece of reusable existing code for checkpoint 5.

**No standalone binaries.** The shared context states "Prebuilt single-file binaries are published on the releases page for Linux, macOS, and Windows. These bundle their dependencies and do not require Node.js." **This is false as of v0.63.0** — the latest GitHub release carries **zero assets**, and `package.json` declares `engines.node >= 22`. Distribution is npm-only and Node 22+ is a hard requirement. Detection must handle the npm install path and **must surface a "Node 22+ required" state**; there is no binary fallback to detect.

## Known adapter limitations affecting the UI

**Session restoration: both adapters support it.** This is better than the prompt anticipated.

| Capability | Codex 1.1.7 | Claude 0.63.0 |
| --- | --- | --- |
| `loadSession` | `true` | `true` |
| `sessionCapabilities.resume` | yes | yes |
| `sessionCapabilities.list` | — | yes |
| `sessionCapabilities.fork` | — | yes |
| `sessionCapabilities.delete` / `.close` | — | yes |
| `sessionCapabilities.additionalDirectories` | — | yes |

Codex implements `loadSession` (`CodexAcpServer.ts:524`) and `resumeSession` (`:547`); Claude implements both (`acp-agent.ts:1534`, `:1524`) and its `newSession` accepts a `_meta.claudeCode.options.resume` id.

**Limitations that do affect the UI:**

1. **Capabilities are runtime-negotiated, not static.** Both adapters compute `authMethods` and (for Claude) terminal auth availability *from the client capabilities we send in `initialize`*. The Connections page cannot hardcode "Claude supports subscription login" — it must render whatever `initialize` returned for that installation at that version.
2. **Claude's subagent transcripts are opt-in and non-standard.** From its README: "ACP 1.2 has no standard subagent tool kind or nested-message relationship. Clients that can render nested transcripts can opt in with `clientCapabilities._meta["subagent-transcript"] = true`", after which nested updates relate to the launching Agent/Task call via `_meta.claudeCode.parentToolUseId`, and Agent/Task calls carry `_meta.claudeCode.subagent = true`. **If we do not advertise it we get the flattened legacy view**, which is the safe default for checkpoint 5. The protocol-compatible tool result is preserved either way.
3. **Claude advertises a `_meta.steering.supported` extension** — clients may inject a follow-up into a running turn instead of queueing a separate `session/prompt`. Non-standard; ignoring it is safe, but it is what a "send while running" affordance would use.
4. **Codex's `loadSession`/`resumeSession` return `Legacy*` response types** (`LegacyLoadSessionResponse`, `LegacyResumeSessionResponse` in `CodexAcpServer.ts`) — the shapes are in flux.
5. **Codex loses MCP servers across load/resume** — `CodexAcpServer.ts:1582`: "Without a thread-scoped startup completion event, loadSession/resumeSession can no longer … Skipping MCP server recovery for load/resume without explicit mcpServers." Not blocking for us (no client MCP servers in scope) but it means a resumed Codex session is not identical to a fresh one.
6. **Claude resume produces a distinguishable not-found error** — `"No conversation found with session ID"` / `"Query closed before response received"` are mapped to `RequestError.resourceNotFound(sessionId)`. The UI can therefore tell "session gone" apart from "agent broken" and offer a clean "start a new session" path. Wire this; it is the common case after a machine restart.
7. **Claude filters models against a `settings.json` `availableModels` allowlist** it reads itself. The model list we show may be narrower than the account's real entitlement, and we do not control it.

## Discrepancies with the shared context

Reported, not silently corrected.

| # | Shared context says | Verified reality | Impact |
| --- | --- | --- | --- |
| **D1** | "Types cross the Rust and TypeScript boundary through `ts-rs`." | **`ts-rs` is not in the project.** Not in `Cargo.toml`, no `#[derive(TS)]`, no bindings output. Every cross-boundary type is hand-mirrored, in up to three places. | Checkpoint 2 must **introduce** ts-rs and its build wiring, not extend it. Scope increase. |
| **D2** | "`agent-client-protocol-tokio`: Tokio utilities for spawning agent processes and wiring stdio transports. Use this instead of writing a bespoke process and transport layer." | Last released **0.11.1 on 2026-04-21**, depends on `agent-client-protocol ^0.11.1`, and **is no longer a workspace member**. Incompatible with 2.0.0. | Conclusion unchanged (don't write `acp/process.rs`) but the mechanism is different: `AcpAgent`/`AcpAgentConfig`/`Stdio` now live in the **core** crate. |
| **D3** | Claude adapter: "Documented authentication is an Anthropic API key supplied through the environment." | At 0.63.0 the adapter advertises **`type: "terminal"` auth methods** for Claude Subscription (`claude-ai-login`) and Anthropic Console (`console-login`), gated on `clientCapabilities.auth.terminal`, plus optional gateway methods. Env vars still route the backend. | **Claude subscription login IS supported.** The shared context's warning against showing it is based on a stale reading. Poly UI's existing PTY is the enabler. Re-verify at the pinned version before shipping the UI. |
| **D4** | Claude adapter: "Prebuilt single-file binaries are published on the releases page for Linux, macOS, and Windows … do not require Node.js. Detection must handle both the npm install and the standalone binary." | Latest release **v0.63.0 has zero assets**. `engines: { node: ">=22" }`. npm-only. | Detection has **one** path, not two, and must gate on Node ≥ 22. Simplifies checkpoint 5; removes a fallback the plan assumed. |
| **D5** | Codex adapter: authentication is "API key through `CODEX_API_KEY` or `OPENAI_API_KEY`". | Also — and preferably — via the **`authenticate` request's `_meta["api-key"].apiKey`** field. Env vars are the fallback. | Prefer the request path: the key never enters the child's environment block. |
| **D6** | "`agent-client-protocol-schema`: lower-level wire types … depend on the schema crate directly only if the core crate does not expose something." | Schema is on a **separate version line** (1.6.0 while core is 2.0.0). | Guidance is right; the reason is stronger than stated — a direct dependency risks a duplicate-version type split. Never add it directly. |
| **D7** | Implied by "Use the official Rust SDK … alongside a multi-threaded Tokio runtime" | The core crate depends on **`async-io`/`async-process`/`blocking` (smol)**, not Tokio. Tokio is a dev-dependency only. | Works fine, but adds an `async-io` reactor thread, and Tokio-specific APIs are unavailable inside SDK-driven callbacks. Use `futures` primitives in handlers. |
| **D8** | `AGENTS.md`: "`execute_sql` command is gated behind the `dev-sql-console` Cargo feature flag (off by default)." | `execute_sql` is registered **unconditionally** (`lib.rs:240`). Only `clear_database` is gated. | Pre-existing; not caused by this rework. Flagged so checkpoint 8 can close it. |
| **D9** | `AGENTS.md` feature list includes `agent` under `src/features/`. | Directory does not exist; removal was complete. | Doc drift only. |

---

# Part 4 — design

## 1. Schema

New tables. Existing tables are untouched except for one additive column on `conversations`.

```sql
-- A configured endpoint or agent installation the user has set up.
-- Replaces provider_configs. `kind` is the discriminant.
CREATE TABLE connections (
    id              TEXT PRIMARY KEY,          -- uuid, stable across renames
    account_id      TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL,             -- 'chat' | 'coding_agent'
    adapter         TEXT NOT NULL,             -- 'openai' | 'anthropic' | 'gemini'
                                               -- | 'openrouter' | 'ollama' | 'lmstudio'
                                               -- | 'openai_compatible'
                                               -- | 'codex' | 'claude_code'
    display_name    TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    base_url        TEXT,                      -- chat only; NULL = adapter default
    secret_ref      TEXT,                      -- opaque handle into the OS keychain.
                                               -- NEVER a secret value.
    extra_headers   TEXT,                      -- JSON; header *names* only, values by secret_ref
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_connections_identity
    ON connections(account_id, adapter, COALESCE(base_url, ''));
CREATE INDEX idx_connections_account_kind ON connections(account_id, kind, position);

-- Models discovered from or enabled on a chat connection.
CREATE TABLE connection_models (
    connection_id   TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    model_id        TEXT NOT NULL,             -- provider-native id, verbatim
    display_name    TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    capabilities    TEXT,                      -- JSON, ts-rs ModelCapabilities
    last_seen_at    TEXT,                      -- NULL = never returned by discovery
    PRIMARY KEY (connection_id, model_id)
);
CREATE INDEX idx_connection_models_enabled ON connection_models(connection_id, enabled);

-- A detected coding-agent install. One row per (connection, resolution attempt).
CREATE TABLE agent_installations (
    connection_id   TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    executable_path TEXT,                      -- resolved absolute path, NULL if unresolved
    launch_args     TEXT NOT NULL DEFAULT '[]',-- JSON array; NEVER a shell string
    detected_version TEXT,
    node_version    TEXT,                      -- gate for claude_code (>= 22)
    status          TEXT NOT NULL,             -- 'ok' | 'missing' | 'incompatible' | 'unknown'
    status_detail   TEXT,
    checked_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Directories a coding agent is allowed to work in.
CREATE TABLE workspaces (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL DEFAULT '',
    path            TEXT NOT NULL,
    display_name    TEXT,
    last_used_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_workspaces_path ON workspaces(account_id, path);

-- A live-or-resumable ACP session. `agent_session_id` is the adapter's own id.
CREATE TABLE acp_sessions (
    id               TEXT PRIMARY KEY,
    connection_id    TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    workspace_id     TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    agent_session_id TEXT,                     -- NULL until the agent returns one
    protocol_version TEXT,                     -- negotiated, NOT the crate version
    can_resume       INTEGER NOT NULL DEFAULT 0,
    state            TEXT NOT NULL,            -- 'active'|'idle'|'ended'|'lost'
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_acp_sessions_connection ON acp_sessions(connection_id, state);

-- Additive; the tagged union's discriminant + payload, stored explicitly.
ALTER TABLE conversations ADD COLUMN runtime_kind TEXT;   -- NULL | 'chat' | 'acp'
ALTER TABLE conversations ADD COLUMN runtime_ref  TEXT;   -- JSON, shape below
```

**The runtime reference as an explicit tagged union.** `runtime_kind` is the discriminant column; `runtime_ref` carries the variant payload. Never infer the variant from which payload fields are non-null.

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum RuntimeRef {
    Chat { connection_id: String, model_id: String },
    Acp  { connection_id: String, acp_session_id: String },
}
```

`runtime_kind` is written from `RuntimeRef`'s tag on every write and is what queries filter on; `runtime_ref` is only ever deserialized after the discriminant has been read. `NULL`/`NULL` means "pre-rework conversation, runtime not yet determined" — see the migration.

**Deliberately not in the schema.** No `secrets` table — secrets go to the OS keychain (`keyring` crate) and only `secret_ref` is stored. No `sessions`-style token column. No per-message `connection_id`; `messages.provider`/`messages.model` stay as they are for display of historical turns.

## 2. Migration plan

One new sqlx migration, `src-tauri/src/db/migrations/2026…_runtime_rework.sql`, plus a Rust data-migration step run once after it (secrets cannot move to a keychain from SQL). Idempotent, and fails safe: **no `DROP TABLE`, no `DELETE` of user data. `provider_configs` is left in place and untouched until checkpoint 8.**

| Old | New | Rule |
| --- | --- | --- |
| `provider_configs` row, `provider_type='OllamaLocal'` | `connections` row, `kind='chat'`, `adapter='ollama'`, `base_url = ollama_host` | Direct |
| `provider_type='AnthropicNative'` | `adapter='anthropic'`, `base_url = api_base_url` | Direct |
| `provider_type='GeminiNative'` | `adapter='gemini'`, `base_url = api_base_url` | Direct |
| `provider_type='OpenAICompatible'` + `preset` | `adapter = preset` when `preset ∈ {openai, openrouter, groq, together, deepseek, lmstudio}`, else `adapter='openai_compatible'` | **Ambiguous, case A** |
| `api_key` / `ollama_api_key` (plaintext) | keychain entry keyed `polyui/connection/{id}`; `connections.secret_ref` = that key | **Ambiguous, case B** |
| `headers` (JSON, may embed secrets) | `extra_headers` verbatim | **Ambiguous, case C** |
| `api_base_url` NULL | `base_url` NULL (adapter default applies at runtime) | Direct |
| `enabled`, `priority` | `enabled`, `position` | Direct |
| `model_suggestions` (JSON array) | one `connection_models` row per entry, `enabled=1`, `last_seen_at=NULL` | Direct |
| `localStorage["default_model"]` | `RuntimeRef::Chat` default in settings | **Ambiguous, case D** |
| `conversations` (all existing rows) | `runtime_kind=NULL`, `runtime_ref=NULL` | **Ambiguous, case E** |
| `messages.provider`, `.model` | unchanged | Historical display only |
| `settings.general.webSearch.apiKeys` | keychain, `polyui/websearch/{provider}` | **Ambiguous, case F** |

**Every ambiguous case, and what the migration does:**

- **Case A — preset → adapter.** `preset` is a free-text column with no constraint; a user may hold `NULL`, an unrecognised string, or a preset that disagrees with `api_base_url` (e.g. `preset='openai'` with an OpenRouter URL). **Rule:** `base_url` wins. Match `api_base_url` against a known-host table first; fall back to `preset` only when `api_base_url` is NULL; fall back to `adapter='openai_compatible'` otherwise. Never drop the row. Record the original `preset` value in `connections.display_name` if `display_name` would otherwise be empty, so nothing is lost.
- **Case B — plaintext keys → keychain.** Three failure modes: the keychain may be unavailable (headless Linux without a Secret Service), the key may be empty-string vs NULL (indistinguishable intent), and the write may partially succeed. **Rule:** treat empty-string and NULL identically as "no secret" (`secret_ref = NULL`). If the keychain write fails, set `secret_ref = NULL`, set `enabled = 0` on that connection, and record a one-time user-facing notice "re-enter the API key for {name}". **Do not fall back to storing the key in SQLite**, and **do not delete the old `provider_configs.api_key` in this checkpoint** — checkpoint 8 clears it after the new path is verified. The migration is re-runnable: it skips any connection that already has a `secret_ref`.
- **Case C — `headers` may contain secrets.** A user could have put `{"Authorization": "Bearer sk-…"}` there. We cannot reliably tell a secret header from a routing header. **Rule:** copy verbatim into `extra_headers` (no behavior change, no data loss), and flag the connection in the UI with "this connection stores header values in the database" plus a one-click migrate-to-keychain action. Do not attempt automatic classification — a false positive breaks a working connection.
- **Case D — the stored default model.** `localStorage["default_model"]` is a client-side string that the Rust migration cannot see, may be empty, may name a model that no longer exists, and — per §6 — may be an `AnthropicNative:…`/`GeminiNative:…` value that the current parser already rejects. **Rule:** a frontend one-shot migration parses it with a *fixed* parser that accepts all four legacy provider names, resolves it against `connections`+`connection_models`, and on success writes a `RuntimeRef::Chat`. On failure it **clears** the key (unlike today's silent-retry-forever behavior) and leaves the default unset. Ambiguity when the old id has no `providerConfigId` and two connections now offer the same model: pick the lowest `position`, and surface the resolved choice in the model selector so the user sees what was chosen.
- **Case E — existing conversations have no runtime.** Nothing in the old schema records which connection a conversation used; `messages.provider` records a *provider type*, not a connection, and only for assistant messages. **Rule:** leave `runtime_kind`/`runtime_ref` NULL. Treat NULL as "chat, resolve on next send from the current selection". Do **not** guess from `messages.provider` — a conversation can span providers, and a wrong guess would silently reroute an existing chat. Backfilling is explicitly rejected.
- **Case F — web-search keys in localStorage.** Same shape as case B, but the source is the renderer. **Rule:** on first run after upgrade, the frontend posts each non-empty key to a Rust command that writes it to the keychain, then **removes the value from the persisted settings object** and rewrites `polyui:settings`. If the keychain write fails, leave the key where it is and show a warning — losing a working web-search key to a failed migration is worse than the status quo. Requires a `SETTINGS_VERSION` bump past 26.

**Idempotency and failure.** The SQL migration uses `INSERT … WHERE NOT EXISTS` keyed on `idx_connections_identity`, so re-running is a no-op. The Rust step checks `secret_ref IS NULL` before each keychain write. If any step fails the migration **returns an error without rolling back the additive DDL** — the new tables existing but empty is a safe state, and the old `provider_configs` path still works because it is not removed until checkpoint 8.

**One pre-existing hazard to remove.** `db/connection.rs:41`'s unconditional `DELETE FROM provider_configs WHERE provider_type NOT IN (…)` runs on **every** startup. It must be deleted as part of checkpoint 2, before the migration reads that table — otherwise a downgrade-then-upgrade cycle silently destroys rows the migration was going to read.

## 3. Module layout

Derived from the existing conventions: Rust domain logic in modules with thin `commands/*.rs` adapters; frontend split `store/` (Zustand, no cross-imports) + `features/<domain>/` + `lib/` (no UI).

**Rust — `src-tauri/src/`**

```
acp/
  mod.rs            AcpHost, spawn/shutdown, the per-agent connect_with task
  session.rs        session lifecycle: new / load / resume / prompt / cancel
  handlers.rs       client-side callbacks the agent calls into us
  events.rs         AcpEvent enum (ts-rs), normalization from SDK types
  install.rs        executable resolution, version + Node>=22 probe
connections/
  mod.rs            Connection, ConnectionKind, Adapter (ts-rs)
  repository.rs     SQLite access for connections / connection_models / workspaces
  secrets.rs        keyring wrapper; secret_ref ↔ OS keychain. No values in logs.
runtime.rs          RuntimeRef tagged union + resolution to a live runtime
commands/
  acp_commands.rs
  connection_commands.rs
```

**Not created, with reasons:**

- **No `acp/process.rs`** — `AcpAgent`/`AcpAgentConfig`/`Stdio` in the core crate cover spawn, process-group teardown, stdio transport, and bounded stderr (Part 3).
- **No `acp/transport.rs`** — same reason.
- **No `acp/protocol.rs`** — the SDK owns the wire types; hand-rolling is forbidden by the shared context.
- **No `providers/registry.rs`** — a registry with a fixed set of adapters known at compile time is a match statement with ceremony. Keep the match; move it to one place (`connections/mod.rs`).
- **No `acp/mock.rs` as a dependency** — `agent-client-protocol-test` is unpublished, so checkpoint 3's mock agent lives in `src-tauri/tests/` as a test-only binary.

`providers/`, `tool_loop.rs`, `stream_emitter.rs`, `models/chat.rs`, `memory/`, `web_search/` stay where they are. `stream_emitter.rs` gains ACP emit methods rather than being replaced.

**Frontend — `src/`**

```
features/connections/
  ConnectionsPage.tsx        replaces the provider half of settings/tabs/ConnectionsTab.tsx
  ConnectionCard.tsx
  AddConnectionDialog.tsx
  AgentInstallStatus.tsx     detection + "install" affordance (confirmation-gated)
features/acp/
  AcpActivity.tsx            plan / tool-call / diff / terminal stream
  PermissionRequest.tsx      never auto-approves
  useAcpSession.ts
lib/acp/
  acp-client.ts              typed Tauri event subscription, mirrors lib/chat/stream-client.ts
  acp-session.ts             accumulator, mirrors lib/chat/stream-session.ts
store/connectionStore.ts     replaces features/providers/index.ts's store
generated/bindings/          ts-rs output — the only place Rust-owned types appear
```

`features/providers/` stays until checkpoint 8 (marked `// REWORK-REMOVE:`). `features/settings/tabs/ConnectionsTab.tsx` keeps its web-search section and delegates the provider list to `features/connections/`.

**Note on `store/connectionStore.ts` placement.** `useProviderStore` currently lives in `features/providers/index.ts`, not `store/`. Both patterns exist in the repo (`features/viewport/viewportStore.ts`, `features/ollama/monitor.ts`). Putting it in `store/` is the better fit here because `coordinator.ts` already reaches into it on auth change, and `store/` is where coordinator-observed stores belong.

## 4. Normalized event model

Two Rust-owned enums, both `#[derive(TS)] #[ts(export)]`, both `#[serde(tag = "type", rename_all = "camelCase")]`. **Neither is hand-mirrored in TypeScript** — that is the point of introducing ts-rs (D1).

```rust
// Replaces the Option-soup of StreamPayload for the BYOK path.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Started    { request_id: String, model_id: String },
    Delta      { request_id: String, text: String },       // delta, as today
    Reasoning  { request_id: String, text: String, done: bool }, // full text, as today
    ToolCall   { request_id: String, call: ToolCallInfo },
    WebSearch  { request_id: String, query: String, status: SearchStatus,
                 results: Option<Vec<SearchResultItem>> },
    Usage      { request_id: String, usage: StreamMetadata },
    Finished   { request_id: String, reason: FinishReason },
    Failed     { request_id: String, error: RuntimeError },
}

#[serde(tag = "type", rename_all = "camelCase")]
pub enum AcpEvent {
    SessionStarted   { session_id: String, agent_session_id: String,
                       protocol_version: String, capabilities: AgentCapabilities },
    AgentMessage     { session_id: String, text: String },
    AgentThought     { session_id: String, text: String },
    Plan             { session_id: String, entries: Vec<PlanEntry> },
    ToolCall         { session_id: String, call: AcpToolCall },
    ToolCallUpdate   { session_id: String, call_id: String, status: ToolCallStatus,
                       content: Option<Vec<ToolCallContent>> },
    Diff             { session_id: String, call_id: String, path: String,
                       old_text: Option<String>, new_text: String },
    TerminalOutput   { session_id: String, terminal_id: String, chunk: String },
    PermissionRequest{ session_id: String, request_id: String,
                       call: AcpToolCall, options: Vec<PermissionOption> },
    AuthRequired     { session_id: String, methods: Vec<AuthMethodDescriptor> },
    TurnEnded        { session_id: String, stop_reason: StopReason },
    Failed           { session_id: String, error: RuntimeError },
}
```

`RuntimeError` is one shared shape (`kind`, `message`, `retryable`, `detail`) replacing today's `Result<_, String>` stringification.

**How they reach React.** Two Tauri events, `chat-event` and `acp-event`, each carrying the enum. The existing `chat-chunk` / `chat-thinking` / `web-search-event` trio stays emitted in parallel until checkpoint 8, marked `// REWORK-REMOVE:`, so the current UI keeps working while the new path is built.

**Emission point:** extend `StreamEmitter` (`src-tauri/src/stream_emitter.rs`) with `emit_chat_event` and `emit_acp_event`. Its `TestStreamEmitter` spy gives the mock-agent tests in checkpoint 3 an assertion surface for free. **Do not write a second emitter abstraction.**

**Existing streaming code that adapts directly:**

| Existing | Reuse for ACP |
| --- | --- |
| `src/lib/chat/stream-client.ts` `TauriEventBus` / `EventBus` | Copy the pattern into `lib/acp/acp-client.ts`, typed on the generated `AcpEvent`. The class is generic in spirit; only the event names and payload type change. |
| `src/lib/chat/stream-session.ts` `StreamSession` | The `request_id → messageId` map, idempotent `finish()`, and pending-count logic map 1:1 onto `session_id → conversationId`. Adapt, don't rewrite. |
| `src/lib/chat/stream-accumulator.ts` `StreamAccumulator` | Reusable as-is for `AgentMessage`/`AgentThought` text. rAF batching matters more for ACP, which is chattier. |
| `src-tauri/src/stream_emitter.rs` | Extend. |
| `src-tauri/src/tool_loop.rs` `ThinkingTagParser` | **Not needed for ACP** — agents emit structured thought blocks. Keep it for the BYOK path only. |
| `src/features/viewport/components/NativeTerminalViewport.tsx` + `src-tauri/src/pty.rs` | **Reuse for ACP terminal-type auth** (D3) and for `TerminalOutput` rendering. This is the biggest reuse win in the whole rework. |

Do **not** reuse the `streamEventBus` singleton (`src/lib/chat/event-bus.ts`) — its first-subscriber-wins guard breaks the moment ACP adds a second consumer (§9.6).

## 5. Checkpoint ordering risks

Ranked. Each is something the audit says will not work as the plan assumes.

1. **Checkpoint 2 is larger than scoped: it must introduce `ts-rs` from zero (D1).** The shared context treats ts-rs as existing infrastructure. It does not exist. Checkpoint 2 must add the dependency, add `#[derive(TS)]`/`#[ts(export)]`, choose an output directory, decide whether generation runs in `build.rs` or a `cargo test` export step, wire it into `bun run build` and CI, and add a drift check. That work is a prerequisite for the type ownership rule in every later checkpoint. **Budget for it explicitly or the rule silently lapses and hand-mirroring continues.**

2. **Checkpoint 3's mock agent has no crate to use.** `agent-client-protocol-test` is a workspace member with no published version. Options are: build the mock in-repo as a test binary (recommended — it also exercises our own `AcpAgentConfig` path), or add a git dependency pinned by rev (violates "pin an exact version in `Cargo.toml`"). Decide before starting checkpoint 3.

3. **The ACP host cannot hold a connection the way the plan implies.** `connect_with` is a scoped closure, not a constructor (Part 3). The host is a long-lived spawned task that parks inside the closure and publishes a `ConnectionTo` clone into state. Any design that says "create the connection and store it in `AppState`" will not compile. The good news is that `Send`-ness removes the thread-confinement complexity the original plan budgeted for — net, this is simpler than expected, but structurally different.

4. **Child-process lifetime collides with `lib.rs:282`'s `std::process::exit`.** That handler exists to work around a Linux teardown deadlock and must not be removed. But it means no `Drop` runs, so `ChildGuard` never fires on app exit. **Checkpoint 3 must kill every ACP child in the `ExitRequested` handler, before `process::exit`, synchronously.** On Windows this is worse: `process_group(0)` is `#[cfg(unix)]` only, so killing the `npx` wrapper can orphan the real adapter and no Job Object catches it. "No orphan or zombie child processes on any exit path" is not free here.

5. **Checkpoint 5's plan is built on two wrong facts about the Claude adapter (D3, D4).** Subscription login *is* supported and needs client terminal capability; standalone binaries *do not exist* and Node ≥ 22 is required. The checkpoint must be re-planned around ACP terminal auth (reusing `pty.rs`) and single-path npm detection with a Node-version gate. Re-verify both against the pinned version before implementing — the adapter shipped 0.63.0 today and releases every 2–3 days.

6. **Checkpoint 4 and 5 both need `unstable_*` cargo features.** `authMethods` — the thing both adapters use to tell us how to log in — is behind `unstable_auth_methods`, off by default. Checkpoint 2 pins the crate; if it does not also enable the right features, checkpoints 4 and 5 will discover mid-implementation that the types are absent, and enabling them then changes the pinned build for everything already written.

7. **Checkpoint 6's provider rework has to fix `parseModelChoiceId` before it can migrate defaults.** The stored-default parser rejects `AnthropicNative`/`GeminiNative` today (§6). The migration's case D depends on reading those values. Fixing the parser must happen *inside* the migration path (a fixed legacy parser), not by editing the existing one — the existing one is also used by the still-live old code path until checkpoint 8.

8. **Checkpoint 7's Connections page cannot render static capability lists.** Both adapters compute their advertised auth methods and session capabilities *from what we send in `initialize`*, at runtime, per installation, per version. Any UI that hardcodes "Codex supports ChatGPT login" will be wrong for a user with `NO_BROWSER=1` set. The page must render negotiated capabilities.

9. **Secret migration can fail on Linux and the plan has no fallback.** `keyring` needs a Secret Service (gnome-keyring / KWallet); a headless or minimal Linux install has none. Cases B and F must both degrade to "connection disabled, re-enter the key" rather than to plaintext, and the UI needs a real state for it. Poly UI ships Linux (see the CEF packaging notes), so this is not hypothetical.

10. **Checkpoint 8 must not delete `provider_configs` data before the keychain path is proven on all three platforms.** The migration deliberately leaves `api_key` in place. Removing it is the last irreversible step and should follow a successful manual verification on Linux, macOS, and Windows — not merely a passing test suite.

11. **`db/connection.rs:41`'s startup `DELETE` must go in checkpoint 2, not checkpoint 8.** It destroys `provider_configs` rows whose `provider_type` is not in a hardcoded list, on every launch, outside any migration. Leaving it until the cleanup checkpoint means every intermediate build can silently eat rows the migration needs to read.

12. **Minor, but it will bite in checkpoint 7:** the `streamEventBus` singleton allows exactly one subscriber. The ACP activity UI is the second one. Retire the singleton (keep `TauriEventBus`) when `lib/acp/acp-client.ts` lands, not later.
