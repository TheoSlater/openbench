# AGENTS.md

This file provides guidance to Coding Agents when working with code in this repository.

## What this is

PolyUI is a Tauri v2 desktop app — a React/TypeScript frontend bundled with a Rust backend. It's a local-first AI chat client that talks to Ollama (and OpenAI-compatible APIs) entirely on-device. SQLite (via `tauri-plugin-sql`) is the persistence layer.

## Commands

```bash
bun install           # install deps
bun run tauri dev     # dev server (Tauri window + Vite HMR)
bun run build         # tsc + vite build (frontend only)
bun run tauri build   # full production build + installer
bun run test          # vitest run (once)
bun run test:watch    # vitest watch
```

Run a single test file: `bun run test -- tests/foo.test.ts`

Tests live in `tests/` (not colocated). They're Node environment, no browser/Tauri APIs available — use the repository injection seam or pure logic imports.

## Architecture

### Frontend (`src/`)

**Stores** (`src/store/`) — Zustand. One store per domain: `authStore`, `chatStore`, `modelStore`, `settingsStore`, `folderStore`, `themeStore`, etc. **Stores must not import each other.** Cross-store effects go through `store/coordinator.ts` (e.g. auth → chat).

**Features** (`src/features/`) — self-contained feature modules: `chat`, `auth`, `sidebar`, `models`, `ollama`, `settings`, `command-palette`, `dictation`, `memory`, `providers`, `folders`, `release-notes`, `web-search`, `agent`.

**Lib** (`src/lib/`) — shared logic with no UI:
- `lib/chat/stream-client.ts` — `EventBus` interface + `TauriEventBus` (typed Tauri event wrapper)
- `lib/chat/stream-accumulator.ts` — pure token accumulation, batched via rAF, no React
- `lib/repositories/` — `ConversationRepository` interface with SQLite impl and in-memory impl; injected via `setRepository()` for tests
- `lib/featureRegistry.ts` — runtime feature flags

**Path alias**: `@/` → `src/`

### Backend (`src-tauri/src/`)

Commands are thin Tauri adapters in `commands/`; domain logic lives in dedicated modules:
- `tool_loop.rs` — streaming + tool calling loop until completion
- `stream_emitter.rs` — `StreamEmitter` trait + Tauri impl + test spy
- `web_search/` — `WebSearchClient` trait + Exa impl + mock
- `auth.rs`, `memory/`, `providers/`, `models/`

`execute_sql` command is gated behind the `dev-sql-console` Cargo feature flag (off by default).

### Data flow

Rust emits typed Tauri events (`chat-chunk`, `chat-thinking`, `web-search-event`). The frontend `TauriEventBus` subscribes; `StreamAccumulator` batches tokens; React hooks consume the accumulator. Multi-model streams each get their own `request_id`.

## Key conventions

- Zustand selectors use `useShallow` for object/array selections to prevent spurious re-renders
- Lazy imports (`React.lazy`) only at route/modal boundaries — not for performance micro-optimization inside features (see `tests/noMixedDynamicImports.test.ts`)
- Token budget discipline in sidebar components is enforced by `tests/sidebarTokenDiscipline.test.ts`
- Domain vocabulary: see `CONTEXT.md` for the full glossary (Conversation, Message, Stream, Tool Loop, Provider, Repository, etc.)

## Branching & PR workflow

- **Never commit directly to `main`.** All changes must be pull-requested.
- Create a feature branch off `main` for each isolated change:
  ```bash
  git checkout main
  git pull
  git checkout -b feat/your-thing
  # commit work
  git push origin feat/your-thing
  # PR feat/your-thing → main
  ```
- Each PR carries only its feature branch commits. Keep `main` clean.
