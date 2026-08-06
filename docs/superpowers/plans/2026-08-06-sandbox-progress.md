# Sandbox Progress Implementation Plan

> **For agentic workers:** Execute inline in this session. Keep unrelated dirty worktree changes.

**Goal:** Keep Poly UI responsive while sandbox startup runs, open the AI viewport immediately, and show animated current sandbox steps until the PTY is ready.

**Architecture:** Make `pty_spawn_command` an async Tauri command whose blocking Docker/Podman work runs on Tauri’s blocking pool. Send sandbox-step events through the existing PTY channel; the frontend stores the latest step in the AI terminal session and renders it through the existing loading overlay.

**Tech Stack:** Tauri v2, Rust, Docker/Podman CLI, React/TypeScript, xterm, Vitest.

## Files

- Modify `src-tauri/src/pty.rs`: async command wrapper, status event emission, blocking worker.
- Modify `src-tauri/src/sandbox.rs`: report runtime/container/bootstrap/tool-preparation steps.
- Modify `src/features/viewport/aiTerminal.ts`: retain latest status in session.
- Modify `src/features/viewport/components/AiTerminalViewport.tsx`: display status while sandbox starts.
- Modify `src/features/viewport/components/TerminalLoading.tsx`: shimmer and step-change animation.
- Modify `tests/aiTerminalParts.test.ts` and `src-tauri/tests/pty.rs`: status and async-path regression coverage.

## Tasks

- [x] Add failing status-event and async-command assertions.
- [x] Add sandbox status callbacks and emit `status` PTY events for runtime, container, bootstrap, tool preparation, and terminal start.
- [x] Move blocking AI PTY setup into `spawn_blocking` while preserving failure relay and PTY session ownership.
- [x] Store/render status, keep drawer open from command start, and animate status changes.
- [x] Run focused tests, sidecar typecheck, Rust checks, build, and `git diff --check`.
