# AI SDK Full Runtime Migration Implementation Plan

> **Execution:** inline in this task. No subagents. Keep each task green and commit at the rollback points below.

**Goal:** Make Vercel AI SDK the only model-generation, streaming, regular-tool, Claude Code, and Codex runtime while preserving PolyUI's SQLite data, visual UI, provider coverage, native security boundary, and concurrent-chat behavior.

**Architecture:** React consumes AI SDK `UIMessageChunk` streams through `@ai-sdk/react` and a small custom Tauri `ChatTransport`. Rust authorizes requests, resolves connection records and keychain secrets, supervises one bundled JavaScript sidecar, and forwards opaque request-scoped JSON lines. The sidecar owns AI SDK Core/providers, tool loops, web search, model discovery, title/memory generation, Claude Code, and Codex. No loopback port, browser secret, Rust SSE parser, Rust tool loop, Rust ACP host, legacy feature flag, or second conversation database remains.

**Selected integrations:** current stable `ai` 7 and matching official provider packages; `ai-sdk-provider-claude-code` for local Claude Code sessions; `ai-sdk-provider-codex-cli` in app-server mode for local Codex sessions. Official `HarnessAgent` is rejected because its Claude/Codex bridge path requires a network sandbox; `@mcpc-tech/acp-ai-provider` is rejected because its current release targets AI SDK 6/provider v3. Exact versions are pinned after source/package verification.

---

## Final runtime and trust boundaries

```text
React visual UI
  -> @ai-sdk/react useChat
  -> TauriChatTransport (request id + connection id; no provider secret)
  -> Tauri ai_runtime_* commands
  -> Rust AiSidecar supervisor (authorization + keychain + lifecycle only)
  -> private JSONL stdin/stdout
  -> bundled sidecar
  -> AI SDK Core / official direct providers / Gateway / local CLI providers
```

The sidecar never binds a socket. Rust writes secrets only to the child stdin request, redacts child diagnostics, and never echoes the resolved connection object to the webview. The sidecar writes AI SDK UI chunks, model summaries, validation results, or structured job results to stdout. Every record has a request id. Rust routes records without parsing provider payloads.

SQLite remains authoritative. `src/lib/ai/messages.ts` is the one mapping boundary between current `Message` entities and AI SDK `UIMessage` parts. Existing text/reasoning/search fields stay readable; one additive `runtimeParts` JSON column stores only structured AI SDK tool/source/agent parts, plus `usage` and finish/error metadata. There is no duplicate AI SDK conversation table.

---

## Task 1: Lock baseline and package decisions

**Files**

- Modify: `tests/settingsMerge.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Add: `sidecar/package-spike.ts` (temporary, delete before commit)
- Inspect completely before edits: `node_modules/ai/docs/**`, `node_modules/ai/src/**`, and installed provider package docs/source

**Steps**

1. Correct the stale v27 settings assertion from `browser` to the already-established `native` default. This is the deterministic baseline failure introduced by merging stale ACP assertions.
2. Re-run `bun run test -- tests/settingsMerge.test.ts tests/reducedMotionPreference.test.tsx`, then `bun run test`. Stop on any failure that is not the known flaky full-suite reduced-motion timeout; if that timeout returns, use systematic debugging and remove the flake before migration.
3. Query current package releases and inspect engines/peer dependencies. Upgrade the AI SDK family together and pin exact compatible versions:
   - `ai`
   - `@ai-sdk/react`
   - `@ai-sdk/openai`
   - `@ai-sdk/anthropic`
   - `@ai-sdk/google`
   - `@ai-sdk/openai-compatible`
   - `@ai-sdk/gateway`
   - `ai-sdk-provider-claude-code`
   - `ai-sdk-provider-codex-cli`
4. Read the newly installed packages' docs and relevant source before writing imports. Record every exact version and experimental/community risk in this plan's implementation notes and architecture docs.
5. Compile a minimal sidecar importing all selected packages with:
   - `bun build sidecar/package-spike.ts --compile --outfile /tmp/polyui-ai-runtime`
   - run the binary's provider-construction self-check
   - inspect `file`, `ldd`/platform equivalent, and byte size
6. If Bun cannot compile a package or the binary requires an unbundled runtime, switch once to a pinned Node 22 runtime plus an esbuild bundle. Record compressed/uncompressed runtime size for Linux, macOS, and Windows. Do not maintain Bun and Node packaging paths.
7. Delete the spike.

**Tests**

```bash
bun run test -- tests/settingsMerge.test.ts tests/reducedMotionPreference.test.tsx
bun run test
bun build sidecar/package-spike.ts --compile --outfile /tmp/polyui-ai-runtime
/tmp/polyui-ai-runtime
```

**Rollback point:** commit `test: capture AI runtime behavior`.

---

## Task 2: Define sidecar protocol and process supervision with TDD

**Files**

- Add: `sidecar/src/protocol.ts`
- Add: `sidecar/src/main.ts`
- Add: `sidecar/src/server.ts`
- Add: `sidecar/src/redact.ts`
- Add: `src-tauri/src/ai_sidecar/mod.rs`
- Add: `src-tauri/src/ai_sidecar/process.rs`
- Add: `src-tauri/src/ai_sidecar/protocol.rs`
- Add: `src-tauri/src/commands/ai_runtime_commands.rs`
- Add: `tests/aiSidecarProtocol.test.ts`
- Add: `src-tauri/src/ai_sidecar/tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

**Protocol**

- Webview commands:
  - `ai_runtime_start(request)` — request id, conversation id, connection id or coding-agent runtime, UI messages, options, account/token
  - `ai_runtime_cancel(requestId)`
  - `ai_runtime_answer(requestId, approvalId, decision)`
  - `ai_runtime_models(connectionId, account/token)`
  - `ai_runtime_validate(draft/connectionId, transient credential, account/token)`
  - `ai_runtime_generate(job, connectionId, payload, account/token)` for title and memory only
- Rust-to-sidecar JSONL:
  - `chat`, `cancel`, `approval`, `list-models`, `validate`, `generate`, `shutdown`
  - includes resolved non-secret connection settings and an optional secret only on stdin
- Sidecar-to-Rust JSONL:
  - `chunk`, `result`, `error`, `ready`, `log`
  - `chunk` carries an opaque AI SDK `UIMessageChunk`
- Tauri event: one `ai-runtime-event`, globally installed once; frontend fan-out by request id.

**Steps**

1. Write protocol serialization/redaction tests first. Assert API keys, custom headers marked secret, Claude/Codex auth data, and capability values never occur in frontend command/event JSON or logs.
2. Implement a strict discriminated JSONL protocol. Reject unknown methods, invalid ids, oversized records, and frontend attempts to send `apiKey`, `credential`, `authorization`, or secret-looking headers on chat requests.
3. Implement `AiSidecar` with one injectable child-process seam, lazy start, ready timeout, request routing, cancellation, bounded pending map, crash fan-out, one automatic restart on the next command, and deterministic shutdown.
4. Reuse only the smallest existing cross-platform child cleanup primitives from `src-tauri/src/acp/lifecycle.rs`; move them into `ai_sidecar/process.rs`. Kill the process tree on app exit so Claude/Codex grandchildren do not survive.
5. Add Tauri commands as thin authorization/keychain adapters. Rust resolves `Connection` and `SecretRef`, writes the sidecar request, and emits the returned opaque chunk. Rust does not inspect UI part/provider stream payloads.
6. Add `sidecar:build`, `sidecar:test`, and `build` integration. Produce the Tauri target-suffixed external binary before packaging; declare only that binary in `bundle.externalBin`.
7. Test crash/restart, process cleanup, cancellation routing, secret redaction, malformed records, and concurrent request isolation with fake child processes.

**Tests**

```bash
bun run test -- tests/aiSidecarProtocol.test.ts
cargo test --manifest-path src-tauri/Cargo.toml ai_sidecar
bun run sidecar:build
```

**Rollback point:** commit `feat: add AI SDK sidecar runtime`.

---

## Task 3: Build AI SDK provider registry and model discovery

**Files**

- Add: `sidecar/src/providers.ts`
- Add: `sidecar/src/models.ts`
- Add: `sidecar/src/errors.ts`
- Add: `sidecar/tests/providers.test.ts`
- Add: `sidecar/tests/fixtures/openai.sse`
- Add: `sidecar/tests/fixtures/anthropic.sse`
- Add: `sidecar/tests/fixtures/gemini.sse`
- Add: `sidecar/tests/fixtures/ollama.sse`
- Modify: `src-tauri/src/connections/mod.rs`
- Modify: `src-tauri/src/commands/connection_commands.rs`
- Modify: `src/features/connections/types.ts`
- Modify: `src/features/connections/registry.ts`
- Modify: `src/features/connections/client.ts`
- Modify: `src/features/connections/store.ts`
- Modify generated bindings for provider values

**Provider mapping**

- OpenAI -> `@ai-sdk/openai`
- Anthropic -> `@ai-sdk/anthropic`
- Gemini -> `@ai-sdk/google`
- Ollama -> `@ai-sdk/openai-compatible` against `/v1` when fixture parity passes
- LM Studio/OpenRouter/custom OpenAI-compatible -> `@ai-sdk/openai-compatible`
- Vercel AI Gateway -> `@ai-sdk/gateway`, optional key and live Gateway catalog

Provider packages are imported lazily inside the matching registry entry. No broad barrel import and no speculative direct provider packages.

**Steps**

1. Write provider stream fixture tests with injected `fetch`. Cover OpenAI-compatible text/tool deltas, Anthropic reasoning, Gemini text/reasoning, Ollama text, cancellation, and normalized provider errors.
2. Implement `createModel(connection, secret)` returning an AI SDK `LanguageModelV4`. Keep provider-specific code limited to model construction and listing endpoints.
3. Implement model discovery:
   - native list endpoints for OpenAI/OpenRouter/OpenAI-compatible/Ollama/Gateway when available
   - documented static/curated fallback only where the provider offers no listing endpoint
   - preserve refresh and cache behavior in existing connections store
4. Proxy validation/listing through `AiSidecar`. Remove generation imports from Rust connection commands.
5. Add Vercel Gateway connection UI and provider/model identifiers without making it required.

**Tests**

```bash
bun run sidecar:test -- providers
bun run test -- tests/connectionsUi.test.ts tests/connectionsFreshProfile.test.tsx tests/runtimeSelector.test.ts
cargo test --manifest-path src-tauri/Cargo.toml connection
```

**Rollback point:** commit `feat: migrate provider streaming`.

---

## Task 4: Migrate regular tool execution and web search

**Files**

- Add: `sidecar/src/tools.ts`
- Add: `sidecar/src/web-search.ts`
- Add: `sidecar/tests/tools.test.ts`
- Add: `sidecar/tests/webSearch.test.ts`
- Modify: `src/features/web-search/types.ts`
- Modify: `src/features/web-search/useWebSearchConfig.ts`
- Modify: `src/features/web-search/WebSearchSettings.tsx`
- Modify: `src/store/settingsStore.ts`
- Modify: `src-tauri/src/connections/secrets.rs`
- Modify: `src-tauri/src/commands/connection_commands.rs` or add narrow web-search secret commands

**Steps**

1. Write failing tests for schema validation, streamed tool-call assembly, sequential calls, tool errors, abort, usage accumulation, web result/citations, and maximum-step cutoff.
2. Implement web search with AI SDK `tool()` and Zod `inputSchema`; use `streamText`/`ToolLoopAgent` current APIs and `stopWhen: isStepCount(...)`. Use provider-native search only when the selected provider documents parity; otherwise call PolyUI's configured search service.
3. Port the existing Exa, Tavily, Ollama search, and minimal local DuckDuckGo behavior to the sidecar. Reuse current ranking/domain rules only where tests show visible behavior; do not port Rust abstractions one-for-one.
4. Emit standard AI SDK tool input/output/error parts and `source-url` citation parts. Use typed `data-web-search` only for PolyUI's searching status that standard parts cannot express.
5. Move web-search credentials to Rust keychain via `SecretRef::for_web_search`. Replace React-state API keys with configured booleans and uncontrolled password inputs. Add a one-time startup migration that reads legacy persisted keys directly, writes them to keychain, then scrubs local storage without placing them in Zustand.
6. Never auto-approve filesystem, shell, credential, network-mutation, or destructive tools. Regular chat initially exposes only web search, which is read-only.

**Tests**

```bash
bun run sidecar:test -- tools webSearch
bun run test -- tests/webSearchConfig.test.ts tests/settingsMerge.test.ts
cargo test --manifest-path src-tauri/Cargo.toml secret
```

**Rollback point:** commit `feat: migrate tool execution`.

---

## Task 5: Migrate Claude Code and Codex onto the common AI SDK path

**Files**

- Add: `sidecar/src/agents.ts`
- Add: `sidecar/src/agent-parts.ts`
- Add: `sidecar/tests/claudeAgent.test.ts`
- Add: `sidecar/tests/codexAgent.test.ts`
- Add: `sidecar/tests/fakes/claude-process.ts`
- Add: `sidecar/tests/fakes/codex-process.ts`
- Modify: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/src/connections/repository.rs`
- Modify: `src-tauri/src/db/rework_migration.rs`
- Modify generated `RuntimeRef` binding
- Modify: `src/features/coding-agents/**`
- Modify: `src/features/chat/components/ChatWorkspace.tsx`

**Session model**

- Rename persisted `acp_session_id` to `agent_session_id`, accepting the old JSON key through a serde alias during backward-safe migration.
- Claude Code uses `ai-sdk-provider-claude-code` with existing login, local `cwd`, `permissionMode: "default"`, explicit `canUseTool`, and session resume.
- Codex uses `ai-sdk-provider-codex-cli` app-server with existing login, persistent process/thread, selected `read-only` or `workspace-write`, `approvalPolicy: "on-request"`, and `autoApprove: false`.
- Both flow through the same sidecar `chat` request and return AI SDK UI chunks.

**Custom typed data parts**

- `data-agent-session`
- `data-agent-permission`
- `data-agent-file-change`
- `data-agent-command`
- `data-agent-plan`
- `data-agent-status`

Standard text, reasoning, tool, error, abort, finish, and usage parts remain standard AI SDK parts. Permission requests are never flattened into text.

**Steps**

1. Write fake-process tests before implementation. Cover session create, continuation, resume, reasoning, tool activity, file changes, terminal activity, plans, explicit permission response, deny-by-default, cancellation, errors, finish, and cleanup.
2. Implement one agent adapter that maps each provider's current callbacks/provider metadata/raw chunks to typed AI SDK data parts.
3. Keep setup/login detection but run current package/CLI probes in the sidecar. Rust may locate configured executables and supervise the sidecar only; it must not parse ACP or agent protocol events.
4. Update coding-agent settings labels/help away from ACP. Default permissions to read-only; require explicit user selection for workspace-write. Do not offer danger-full-access as a default.
5. Reuse the existing activity UI by feeding it persisted typed parts, then rename `AcpActivity`/store/reducer to neutral agent names or fold the small reducer into message rendering.

**Tests**

```bash
bun run sidecar:test -- claudeAgent codexAgent
bun run test -- tests/codingAgentSetup.test.tsx tests/acpActivity.test.ts tests/runtimeBindings.test.ts
cargo test --manifest-path src-tauri/Cargo.toml runtime
```

Rename ACP-named tests as implementation is deleted.

**Rollback point:** commit `feat: migrate coding agents`.

---

## Task 6: Move React chat consumption to `@ai-sdk/react`

**Files**

- Add: `src/lib/ai/transport.ts`
- Add: `src/lib/ai/transport-manager.ts`
- Add: `src/lib/ai/messages.ts`
- Add: `src/features/chat/runtime/ChatRuntime.tsx`
- Add: `src/features/chat/runtime/ModelChatSession.tsx`
- Add: `tests/aiTransport.test.ts`
- Add: `tests/aiMessagePersistence.test.ts`
- Add: `tests/multiModelAiRuntime.test.ts`
- Modify: `src/features/chat/hooks/useChatStream.ts`
- Modify: `src/features/chat/components/ChatWorkspace.tsx`
- Modify: `src/store/chatStore.ts`
- Modify: `src/types/chat.ts`
- Modify: `src/lib/repositories/types.ts`
- Modify: `src/lib/repositories/index.ts`
- Modify: `src-tauri/src/db/connection.rs`
- Modify: `src/lib/chat/title-generation.ts`
- Modify: `src-tauri/src/memory/service.rs`
- Modify: `src-tauri/src/memory/extractor.rs`
- Modify: `src-tauri/src/mobile_pairing.rs`

**Steps**

1. Write TDD coverage for transport chunk routing, abort, retries, parallel request isolation, partial persistence, restored structured parts, and unrelated-conversation render isolation.
2. Implement one module-level Tauri event listener in `transport-manager.ts`. Each `TauriChatTransport` registers by request id and returns a `ReadableStream<UIMessageChunk>`. Abort calls the request-scoped cancel command.
3. Render one headless `ModelChatSession` per active model request. Each owns one `useChat` instance, so parallel model responses stay independently addressable. Preserve existing request ids when no AI SDK response id exists; use AI SDK message ids for persisted assistant messages.
4. Throttle UI updates using the current documented `@ai-sdk/react` option. Persist meaningful part changes and terminal state, not every token. Keep existing rAF batching only if current `useChat` lacks a documented throttle.
5. Map AI SDK messages at `src/lib/ai/messages.ts`:
   - text -> `content`
   - reasoning -> `thinking`
   - web tool/source parts -> existing `webSearch`
   - agent/tool/source/custom parts -> `runtimeParts`
   - usage/finish/error -> additive fields
6. Preserve queue/background/regenerate/retry logic in the existing hook, but replace its listener/session/accumulator internals. Keep `useShallow`, stable callbacks, and per-conversation selectors.
7. Proxy title and memory jobs to the sidecar's AI SDK `generateText`/structured output. Rust retains SQLite/native domain coordination only.
8. Route mobile chat through sidecar text mode. Rust frames already-produced text deltas for the paired client without provider parsing.
9. Add backward-safe message columns and migration tests.

**Tests**

```bash
bun run test -- tests/aiTransport.test.ts tests/aiMessagePersistence.test.ts tests/multiModelAiRuntime.test.ts
bun run test -- tests/chatStreamFixes.test.ts tests/conversationMetadata.test.ts
cargo test --manifest-path src-tauri/Cargo.toml memory
cargo test --manifest-path src-tauri/Cargo.toml mobile_pairing
```

**Rollback point:** commit `refactor: move chat UI to AI SDK transport`.

---

## Task 7: Delete the legacy runtime

**Delete after caller search is empty**

- `src-tauri/src/providers/`
- `src-tauri/src/tool_loop.rs`
- `src-tauri/src/stream_emitter.rs`
- `src-tauri/src/acp/`
- `src-tauri/src/commands/acp_commands.rs`
- obsolete Rust Claude/Codex ACP adapters and mock ACP binary
- Rust web-search generation clients after sidecar parity: `src-tauri/src/web_search/`
- `src/lib/chat/stream-client.ts`
- `src/lib/chat/stream-session.ts`
- `src/lib/chat/stream-accumulator.ts`
- `src/features/acp/client.ts`
- `src/features/acp/useAcpChat.ts`
- obsolete ACP generated bindings
- obsolete stream/ACP tests and stale architecture guards, replacing behavior coverage rather than merely deleting it
- stale ACP/provider architecture plan/docs duplicated by the final architecture document

**Modify**

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/Cargo.toml`
- `package.json`
- relevant generated binding index
- architecture guard tests

**Steps**

1. Search every legacy symbol and command. Move any unrelated executable detection, native terminal, keychain, repository, auth, memory, updater, or download behavior before deleting a directory.
2. Remove old Tauri commands/events, generated bindings, provider parsers, frontend accumulator/event bus, ACP host/session translation, and feature flags.
3. Remove unused Cargo crates, expected at minimum `agent-client-protocol` and `ollama-rs`; remove `async-stream`, `tokio-stream`, `async-process`, or others only when `cargo machete`/caller search proves unused. Keep `reqwest` where updater/dictation/native downloads still require it.
4. Remove unused npm packages only after `bun run build` proves imports are gone.
5. Add architecture guards that reject the deleted command/event/type names and reject provider secret fields in serialized frontend types.

**Deletion proof**

```bash
rg -n "chat_stream|chat-runtime-event|ChatRuntimeEvent|StreamAccumulator|TauriEventBus|tool_loop|stream_emitter|ConnectionProviderAdapter|ChatProvider|SseParser|acp_start_session|acp-session-event|AcpHost|agent_client_protocol|acp_session_id" src src-tauri/src tests package.json src-tauri/Cargo.toml
rg -n "apiKey|api_key|credential|Authorization" src/store src/features/chat src/lib/ai
```

Both searches must be empty except explicit negative architecture tests, one-time legacy secret migration code, and non-provider auth UI code reviewed line by line.

**Rollback point:** commit `refactor: remove legacy AI runtime`.

---

## Task 8: Documentation, packaging evidence, and full verification

**Files**

- Add: `docs/architecture/ai-sdk-runtime.md`
- Modify: `CONTEXT.md`
- Modify: `README.md` if local development commands are documented there
- Modify: `docs/image-upload.md`
- Delete or rewrite stale ACP/provider runtime docs under `docs/superpowers/plans/`

**Document**

- final diagram and request lifecycle
- sidecar start/restart/shutdown
- keychain-to-stdin secret flow
- direct BYOK registry versus optional Gateway
- UI message streaming and SQLite mapping
- regular tool loop and web search
- Claude/Codex session continuation/resume
- read-only/workspace-write permission model
- Bun or Node packaging choice and exact commands
- Linux/macOS/Windows sidecar and installer size impact
- manual provider and agent smoke checks
- selected beta/community package risks and pins

**Fresh verification**

```bash
bun install
bun run test
bun run build
bun run sidecar:test
bun run sidecar:build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
bun run tauri build
```

If the host lacks platform packaging tools, capture the exact command, stderr, and missing tool while completing every other check.

**Final audit**

1. Inspect `git diff <base>...HEAD`, `git status`, and every commit.
2. Count production lines added/deleted excluding tests/docs/generated/lockfiles.
3. List dependencies added/removed.
4. Compare Rust binary and sidecar byte sizes; compare produced installer to the base artifact when available.
5. Confirm deleted custom AI production lines exceed new custom AI production lines. If not, explain the unavoidable delta before any success claim.
6. Run deletion searches again after the last build.
7. Commit docs only after fresh verification, then re-run any command affected by generated files.

**Rollback point:** commit `docs: document AI SDK architecture`.

Working tree must be clean. Do not push or open a PR.

