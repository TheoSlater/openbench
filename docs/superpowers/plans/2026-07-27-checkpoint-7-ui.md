# Checkpoint 7 UI Implementation Plan

> **For agentic workers:** Execute inline. Keep each task test-first.

**Goal:** Replace legacy provider/model UI with Rust-backed connections, unified runtime selection, and functional ACP activity/permission surfaces.

**Architecture:** Add one Tauri command module exposing connection summaries, workspaces, conversation runtime changes, and ACP lifecycle actions. Frontend consumes generated Rust types through focused clients/stores; one parameterized connections UI and one virtualized runtime selector serve every runtime.

**Tech Stack:** Rust, Tauri, SQLite, ts-rs, React, TypeScript, Zustand, shadcn/Radix, Tailwind, TanStack Virtual, Vitest.

## Global Constraints

- No terminal scraping, plaintext secrets, placeholder actions, auto-approval, or per-render process spawning.
- Coding-agent sessions require a valid workspace.
- Runtime-family changes create or fork conversations; never mutate one in place.
- Rust owns all boundary types.

### Task 1: Complete Rust UI contract

**Files:** `src-tauri/src/connections/mod.rs`, `repository.rs`, `commands/runtime_commands.rs`, `acp/host.rs`, `lib.rs`, migration and Rust tests.

- [ ] Add failing repository tests for validation summaries, connection removal, workspaces, recents, and runtime fork persistence.
- [ ] Run targeted Rust tests and confirm expected failures.
- [ ] Add minimal schema/repository/command code.
- [ ] Add failing mock-agent tests for session start, prompt, cancel, events, and permission answer.
- [ ] Store live ACP connections in host and expose lifecycle commands.
- [ ] Generate ts-rs bindings and run targeted tests.

### Task 2: Connections page

**Files:** `src/features/connections/*`, `src/features/settings/tabs/ConnectionsTab.tsx`, Vitest tests.

- [ ] Add failing state/render/action tests across agent and provider states.
- [ ] Add typed client/store and parameterized provider card.
- [ ] Wire configure, verify/test, remove, model refresh/manual model actions.
- [ ] Run targeted tests.

### Task 3: Unified runtime selector

**Files:** `src/features/runtime-selector/*`, chat header/store wiring, Vitest tests.

- [ ] Add failing grouping/search/keyboard/family-transition tests.
- [ ] Add virtualized grouped list using existing Popover and TanStack Virtual.
- [ ] Add workspace picker and explicit new/fork flow.
- [ ] Replace legacy model selector usage and run targeted tests.

### Task 4: ACP activity and permissions

**Files:** `src/features/acp/*`, chat stream/message wiring, Vitest tests.

- [ ] Add failing reducer tests for grouped activity, completion cleanup, failures, and process-death permission withdrawal.
- [ ] Add event client/store and grouped activity renderer.
- [ ] Add permission prompt using only advertised choices.
- [ ] Wire cancel and cleanup into conversation switching.
- [ ] Run targeted tests.

### Task 5: Verification

- [ ] Run formatter, frontend tests/build, Rust tests/check/clippy, and production Tauri build.
- [ ] Record deliberate omissions, boundary types, contradictions, and Theo manual checklist.
