# Remove Poly Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete Poly Agent without changing normal chat, providers, web search, memory, or other features.

**Architecture:** Remove Agent-owned modules first, then remove only their imports, state, persistence fields, native commands, and dependencies from shared files. Keep generic feature metadata and unrelated dirty work intact.

**Tech Stack:** React, TypeScript, Zustand, Tauri v2, Rust, SQLite, Vitest.

## Global Constraints

- Delete Poly Agent only.
- Preserve all unrelated features and existing user changes.
- Add no replacement abstraction or dependency.

---

### Task 1: Frontend removal

**Files:**
- Delete: `src/features/agent/**`
- Modify: shared React, store, repository, feature-registry, and chat type files importing Agent modules or persisting Agent state
- Delete: Agent-only tests and `scripts/sync-agent-types.mjs`

**Interfaces:**
- Consumes: existing normal chat submission and message rendering paths
- Produces: frontend with no Poly Agent imports, controls, message state, or metadata

- [ ] **Step 1: Remove Agent-owned files and tests**

Delete `src/features/agent`, Agent-only tests, and generated-type sync script.

- [ ] **Step 2: Remove shared frontend wiring**

Remove Agent imports, feature registration, composer/run branches, viewport UI, repository columns, and message fields while retaining existing chat behavior.

- [ ] **Step 3: Verify frontend**

Run:

```bash
bun run test
bun run build
```

Expected: both exit `0`.

### Task 2: Native removal

**Files:**
- Delete: `src-tauri/src/agent_mcp_server.rs`
- Delete: `src-tauri/src/agent_viewport.rs`
- Delete: `src-tauri/src/agent_viewport_collector.js`
- Delete: `src-tauri/src/commands/agent_process_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/system_commands.rs`
- Modify: `src-tauri/src/db/connection.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: Tauri command registration and SQLite schema
- Produces: native app with no Agent command, viewport, process, MCP, or message-column support

- [ ] **Step 1: Delete Agent-owned native modules**

Delete four Agent runtime files.

- [ ] **Step 2: Remove native registrations and schema**

Remove Agent module declarations, command imports/handlers, workspace helpers, message `agent` column, and Agent-only dependencies.

- [ ] **Step 3: Verify native code**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: exit `0`.

### Task 3: Residue check

**Files:**
- Inspect: repository

**Interfaces:**
- Consumes: completed frontend and native removals
- Produces: proof that Poly Agent names and imports are gone

- [ ] **Step 1: Scan**

Run:

```bash
rg -n -i --hidden --glob '!node_modules' --glob '!target' --glob '!.git' 'poly[ _-]?agent|features/agent|agent_viewport|agent-process'
```

Expected: no product-code matches.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only Poly Agent removal plus pre-existing unrelated changes.
