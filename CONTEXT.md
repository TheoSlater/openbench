# PolyUI domain and runtime context

## Core concepts

- **Conversation** — SQLite-backed chat containing user and assistant messages.
- **Message** — one persisted turn. Text, reasoning, attachments, citations, AI SDK runtime parts, usage, finish state, and agent session metadata live on this entity.
- **Connection** — provider kind, endpoint, and model catalog reference. Database rows contain keychain references, never credentials.
- **Runtime** — either a direct/Gateway chat model or a local Claude Code/Codex coding agent.
- **Request** — one isolated stream identified by `requestId`. Multi-model chat starts independent requests.
- **Sidecar** — bundled Bun executable owning all AI SDK generation, streaming, tools, provider normalization, and coding-agent protocol handling.

## Runtime flow

```text
React UI
  -> @ai-sdk/react useChat
  -> TauriChatTransport
  -> Rust authorization/keychain/supervisor
  -> private JSONL stdin/stdout
  -> Bun sidecar
  -> Vercel AI SDK providers/tools or local Claude Code/Codex
```

Rust does not construct provider requests, parse provider streams, run model tool loops, accumulate chat tokens, or translate coding-agent protocols. Rust retains Tauri lifecycle, SQLite coordination, OS keychain access, mobile framing, and sidecar process-tree cleanup.

## Module map

```text
sidecar/src/providers.ts          provider registry + model discovery
sidecar/src/runtime.ts            AI SDK streamText/tool-loop entry
sidecar/src/web-search.ts         schema-validated AI SDK search tool
sidecar/src/agents.ts             Claude Code/Codex AI SDK providers
sidecar/src/server.ts             strict request-scoped JSONL dispatcher
src/lib/ai/transport.ts           AI SDK ChatTransport over one Tauri listener
src/lib/ai/messages.ts            sole Message <-> UIMessage mapping boundary
src/features/chat/runtime/        headless @ai-sdk/react sessions
src-tauri/src/ai_sidecar/         supervision and opaque record routing
```

## Conventions

- SQLite remains sole conversation source of truth. Do not add another chat database.
- Provider and web-search secrets stay in OS keychain. Frontend sends connection IDs only.
- Store structured AI SDK parts in `runtimeParts`; do not duplicate text/reasoning in a second representation.
- Zustand stores must not import each other. Cross-store effects go through coordinators or imperative reads at action boundaries.
- Use `useShallow` for grouped selectors. Keep one global runtime listener and request-scoped fan-out.
- Coding agents default to read-only. Workspace writes need explicit mode selection and each dangerous operation needs approval.
- `execute_sql` remains gated behind `dev-sql-console` and disabled by default.

See [AI SDK runtime architecture](docs/ai-sdk-runtime.md) for lifecycle, security, packaging, and smoke tests.
