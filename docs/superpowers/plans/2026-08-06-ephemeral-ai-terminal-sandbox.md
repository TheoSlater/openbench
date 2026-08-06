# Ephemeral AI Terminal Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every AI terminal command through a disposable, isolated Linux container with lazy tooling, reusable safe host-tool imports, cleanup, and preview port forwarding.

**Architecture:** Keep the existing sidecar tool and visible xterm relay, but make Tauri's AI PTY path a thin adapter over a Rust `SandboxManager`. The manager owns per-conversation containers, temporary workspaces, capability provisioning, host-tool cache metadata/imports, and loopback TCP proxies; it never falls back to a host shell. The existing human terminal PTY remains separate.

**Tech Stack:** Rust/Tauri v2, `portable-pty`, Docker/Podman CLI, Node/TypeScript sidecar, React/xterm, Vitest.

## Global Constraints

- AI commands must never execute through the host shell or host working directory.
- Sandbox runtime must fail closed when Docker/Podman is unavailable; no host-execution fallback.
- Sandbox exposes only `/workspace`, `/home/sandbox`, and `/tmp`; no host home, credentials, sockets, or app secrets are mounted.
- Bootstrap installs bash, coreutils, curl, git, ca-certificates, tar, gzip, unzip, Node.js, npm, and npx only.
- Python, Rust, Go, Java, Bun, build-essential, ffmpeg, ImageMagick, sqlite, and other tools install lazily once per sandbox.
- Host imports copy executable bytes into the sandbox; host binaries are never executed directly.
- Sandbox lifecycle is keyed by conversation id, destroyed on explicit conversation deletion and app exit.
- Port discovery/proxying must expose loopback URLs only.
- Preserve unrelated dirty worktree changes.

### Task 1: Add the Rust sandbox manager

**Files:**
- Create: `src-tauri/src/sandbox.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/sandbox.rs` unit tests

**Interfaces:**
- `SandboxManager::new(app: &tauri::AppHandle) -> Result<Self, String>`
- `SandboxManager::spawn_command(&self, session_id, command, cwd, cols, rows) -> Result<SandboxCommand, String>`
- `SandboxManager::destroy(session_id) -> Result<(), String>`
- `SandboxManager::destroy_all() -> Result<(), String>`
- `SandboxManager::ports(session_id) -> Result<Vec<SandboxPort>, String>`
- `sandbox_destroy` and `sandbox_ports` Tauri commands

- [x] **Step 1: Write tests for sandbox-only cwd validation, capability mapping, missing-command parsing, and cache metadata fields.**
- [x] **Step 2: Implement a Docker/Podman runtime selector using fixed executable paths and fail-closed errors.**
- [x] **Step 3: Implement per-session container creation with a private temporary workspace, root-only bootstrap, sandbox user, no-new-privileges, dropped capabilities, resource limits, and no host mounts except the temporary `/workspace`.**
- [x] **Step 4: Implement command execution through `docker exec`/`podman exec` under `sandbox`, with `/workspace` as default cwd and absolute cwd allow-listing.
- [x] **Step 5: Implement command-not-found parsing and one-time lazy apt installation for common capabilities, preflighting and provisioning the original command once.
- [x] **Step 6: Implement host executable discovery, checksum/architecture/dependency/import-strategy manifest persistence, static/script compatibility checks, and copy imports into `/opt/poly-tools/bin`.
- [x] **Step 7: Implement `/proc/net/tcp` port discovery and loopback forwarding, returning stable preview URLs without exposing host network listeners beyond `127.0.0.1`.
- [x] **Step 8: Register manager state and cleanup it before the existing hard-exit path.
- [x] **Step 9: Run `cargo test --lib sandbox` and `cargo check`.

### Task 2: Route AI PTY commands through the manager

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ai_sidecar/mod.rs`

**Interfaces:**
- AI `pty_spawn_command` accepts `sandbox_id` and asks `SandboxManager` for the isolated command.
- Existing `pty_spawn` remains human-terminal-only.

- [x] **Step 1: Add a regression test/source assertion that AI command spawning does not use `CommandBuilder::new_default_prog()` or `dirs::home_dir()`.**
- [x] **Step 2: Replace the AI command builder with the manager-produced Docker/Podman command while retaining PTY data/exit relay.
- [x] **Step 3: Relay sandbox preview events through Tauri and add explicit destroy command handling.
- [x] **Step 4: Run `cargo test --test pty` and focused AI terminal tests.

### Task 3: Carry conversation sandbox identity through the sidecar and UI

**Files:**
- Modify: `sidecar/src/terminal.ts`
- Modify: `sidecar/src/runtime.ts`
- Modify: `sidecar/src/protocol.ts`
- Modify: `src-tauri/src/commands/ai_runtime_commands.rs`
- Modify: `src/lib/ai/transport.ts`
- Modify: `src/features/viewport/aiTerminal.ts`
- Modify: `src/features/viewport/components/AiTerminalViewport.tsx`
- Test: `tests/aiToolsTerminal.test.ts`
- Test: `tests/aiSidecarProtocol.test.ts`
- Test: `tests/aiTerminalParts.test.ts`

**Interfaces:**
- `data-terminal` start data carries `sandboxId`.
- Terminal tool description states sandbox semantics and `/workspace` paths.

- [x] **Step 1: Add failing tests proving terminal start carries conversation sandbox id and frontend passes it to `pty_spawn_command`.
- [x] **Step 2: Pass `conversationId` into `createTerminalTool` and emit it with the start chunk.
- [x] **Step 3: Validate and forward sandbox id through Rust/sidecar protocol without allowing arbitrary host paths.
- [x] **Step 4: Update xterm labels/errors to say sandbox, not host PTY.
- [x] **Step 5: Run `bun run sidecar:typecheck` and focused terminal tests.

### Task 4: Destroy sandboxes on explicit conversation deletion

**Files:**
- Modify: `src/store/chatStore.ts`
- Modify: `src/features/viewport/aiTerminal.ts` or `src/lib/ai/transport.ts`
- Modify: `tests/aiTerminalParts.test.ts` and relevant chat-store tests

- [x] **Step 1: Add a small Tauri destroy helper and test its request shape.
- [x] **Step 2: Call it after single, multi-select, and delete-all conversation operations; ignore already-destroyed sessions but surface no host fallback.
- [x] **Step 3: Run focused store and terminal tests.

### Task 5: Add preview-panel plumbing

**Files:**
- Modify: `src/features/viewport/viewportStore.ts`
- Modify: `src/features/viewport/components/ViewportDrawer.tsx`
- Create: `src/features/viewport/components/SandboxPreviewViewport.tsx`
- Modify: `src/features/viewport/aiTerminal.ts`
- Test: `tests/viewportStore.test.ts` and a focused preview test

- [x] **Step 1: Add a preview tab state keyed by sandbox port event.
- [x] **Step 2: Listen for loopback sandbox-port events, open/update preview tab, and render an iframe with the returned loopback URL.
- [x] **Step 3: Close preview state with the sandbox and verify tab behavior.

### Verification

- [x] `bun run sidecar:typecheck`
- [x] `bun run test -- tests/aiTransport.test.ts tests/aiToolsTerminal.test.ts tests/aiSidecarProtocol.test.ts tests/aiTerminalParts.test.ts tests/viewportStore.test.ts`
- [x] `bun run build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] Inspect `git diff --check` and confirm no AI path calls host shell/default cwd.

`bun run test` is 257/258: the remaining pre-existing `runtimeBindings.test.ts` fixture omits tracked generated bindings (`AgentInstallation`, `PathSource`, and `VerificationResult`).
