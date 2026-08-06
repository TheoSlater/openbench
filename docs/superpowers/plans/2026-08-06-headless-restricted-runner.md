# Headless Restricted Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the existing sandbox implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let safe, read-only AI commands run without Docker/Podman while keeping the full shell container-only.

**Architecture:** `SandboxManager` first classifies a command against a fixed no-shell allowlist. Approved commands run as fixed host executables with cleared environment, translated paths, an app-owned ephemeral workspace, and no write-capable binary. All other commands use the existing Docker/Podman session; if that runtime is unavailable, the command fails closed.

**Tech Stack:** Rust/Tauri, `portable-pty`, existing `SandboxManager`, Vitest/Rust tests.

## Global Constraints

- Never execute an arbitrary AI command through the host shell.
- Headless mode is read-only and workspace-isolated; it never exposes the user home or project directory.
- Do not add a prebuilt image or a dependency.
- Preserve the existing Docker/Podman path for unrestricted development commands.

---

### Task 1: Add the restricted command classifier

**Files:**
- Modify: `src-tauri/src/sandbox.rs`
- Test: `src-tauri/src/sandbox.rs` unit tests

**Interfaces:**
- Produces `headless_command(session, cwd, command) -> Result<Option<SandboxCommand>, String>`.
- Produces `HeadlessSession` state and `SandboxCommand` fields for host cwd/environment/mode.

- [x] **Step 1: Write tests for allowed and rejected syntax**

Cover `pwd`, `ls`, `cat relative-file`, and `git status --short`; reject `sh -c`, pipes, redirects, command substitution, `rm`, `node -e`, absolute host paths, and `..` traversal.

- [x] **Step 2: Implement the fixed allowlist**

Parse only plain tokens, map names to `/bin` or `/usr/bin` executables, translate only `/workspace`, `/home/sandbox`, and `/tmp` paths into the headless workspace, and clear inherited environment variables.

- [x] **Step 3: Run the focused Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sandbox::tests`

Expected: all sandbox tests pass.

### Task 2: Wire headless lifecycle into the manager and PTY

**Files:**
- Modify: `src-tauri/src/sandbox.rs`
- Modify: `src-tauri/src/pty.rs`
- Test: `src-tauri/tests/pty.rs` and sandbox unit tests

**Interfaces:**
- `SandboxManager::spawn_command` returns headless plans before runtime discovery when safe.
- `SandboxCommand` carries `cwd`, fixed `env`, and `headless` mode.

- [x] **Step 1: Add per-session ephemeral headless workspace state**

Create private `workspace`, `home/sandbox`, and `tmp` directories. Reuse them for restricted commands, remove them on destroy/reset/idle cleanup, and never create a Docker container for this lane.

- [x] **Step 2: Apply command cwd/environment in `pty.rs`**

Set `CommandBuilder` cwd and fixed environment only for headless commands. Skip container port polling and container-only resource calls; retain PTY kill/exit relay.

- [x] **Step 3: Test no host-shell fallback**

Assert the AI PTY path still contains no `new_default_prog`, shell interpreter, or home-directory cwd, while headless plans use only allowlisted fixed executables.

### Task 3: Diagnostics, docs, and verification

**Files:**
- Modify: `src-tauri/src/sandbox.rs`
- Modify: `src/features/viewport/aiTerminal.ts`
- Modify: `src/features/viewport/components/AiTerminalViewport.tsx`
- Modify: `docs/ai-sdk-runtime.md`

- [x] **Step 1: Report headless state without host paths**

Expose `host-restricted` runtime state and empty port/capability data; never serialize the actual temporary workspace path.

- [x] **Step 2: Document the behavior**

State that simple read-only commands can run headless, while writes, shell syntax, package installs, servers, and arbitrary tools require Docker/Podman.

- [x] **Step 3: Run release checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`, `bun run test`, `bunx tsc --noEmit`, `bun run build`, `rustfmt --check`, and `git diff --check`.

Expected: all pass; Docker E2E remains unchanged.
