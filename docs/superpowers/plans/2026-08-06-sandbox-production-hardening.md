# Finish production sandbox hardening

> **For implementation:** execute task-by-task. Preserve the existing
> disposable Docker/Podman boundary and do not add a prebuilt image.

**Goal:** close the remaining production gaps: repeatable sandbox E2E checks,
realistic resource/network controls, diagnostics, and crash recovery.

## Task 1: Restore the frontend release gate

**Files:** `tests/runtimeBindings.test.ts` and generated binding inventory.

1. Reconcile the expected generated binding list with the tracked runtime
   bindings (`AgentInstallation`, `PathSource`, and `VerificationResult` are
   present).
2. Keep the generated-file and secret-field assertions intact.

Verify with:

```bash
bun run test -- tests/runtimeBindings.test.ts
```

## Task 2: Add sandbox end-to-end smoke coverage

**Files:** `src-tauri/tests/sandbox_runtime.rs` or an equivalent integration
test plus a small test-only fake runtime seam in `src-tauri/src/sandbox.rs`.

1. Exercise the command-building/security contract without requiring a local
   Docker daemon in ordinary CI: no host shell, only Docker/Podman runtime,
   fixed container labels, no host secret mounts, and allowed cwd roots.
2. Add an opt-in real-runtime smoke test guarded by
   `POLYUI_SANDBOX_E2E=1`; skip cleanly when Docker/Podman is unavailable.
3. Cover create/reuse, lazy capability attempt, port metadata, stop, reset,
   and cleanup. Use an exact test-owned sandbox id and remove it on failure.
4. Add a crash-recovery test seam for stale labeled containers/workspaces so
   the reaper can be tested without deleting unrelated temp files.

Verify with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sandbox
POLYUI_SANDBOX_E2E=1 cargo test --manifest-path src-tauri/Cargo.toml sandbox_e2e -- --nocapture
```

## Task 3: Enforce resource ceilings and idle cleanup

**Files:** `src-tauri/src/sandbox.rs`, `src-tauri/src/pty.rs`, diagnostics
types/tests.

1. Keep current CPU/RAM/PID limits and make the configured values named
   constants surfaced in diagnostics.
2. Add a portable disk guard that measures the exact bind-mounted workspace
   before and after commands; reject growth beyond the configured ceiling with
   a cleanup/reset message. Keep reset available when over limit.
3. Track last activity per sandbox. Start a lightweight reaper thread that
   destroys only sessions idle beyond a conservative TTL, excluding active PTY
   sessions and emitting `sandbox-destroyed`.
4. Do not impose a command timeout: long-lived dev servers remain valid and
   have explicit stop controls.

Verify with unit tests for size/TTL decisions and a PTY activity test.

## Task 4: Add network policy without breaking installs

**Files:** `src-tauri/src/sandbox.rs`, runtime policy tests/docs.

1. Keep container bridge networking for npm/apt/git.
2. Reject container addresses targeting loopback, link-local metadata, and
   private host ranges in the preview forwarder; only forward the discovered
   container IP to a loopback-bound Poly listener.
3. Add a documented egress policy mode: default package/development egress,
   with host/private-network access blocked where the runtime supports it.
4. Fail closed when a runtime cannot apply/verify the requested policy; never
   fall back to host execution.

Verify with pure IP policy tests and Docker/Podman smoke assertions.

## Task 5: Add sandbox diagnostics to the UI

**Files:** `src-tauri/src/sandbox.rs`, `src/features/viewport/viewportStore.ts`,
`src/features/viewport/components/AiTerminalViewport.tsx`,
`src/features/viewport/components/ViewportDrawer.tsx`, tests.

1. Emit a typed sandbox status snapshot with lifecycle, container id, runtime,
   capabilities, active ports, CPU/RAM/PID limits, workspace bytes, and last
   activity. Never include host paths or secrets.
2. Show a compact status badge/popover in the AI terminal header and a clear
   “cleaned up / reset / unavailable” state after lifecycle events.
3. Show active preview ports and resource usage only when available; avoid a
   dashboard that competes with the terminal.

Verify with store/component tests and a source assertion that diagnostics do
not expose host paths.

## Task 6: Crash recovery and release verification

1. Run the opt-in smoke test under Docker and Podman where available.
2. Simulate process termination during bootstrap and command execution; verify
   the next startup reaps only labeled stale containers and exact workspace
   names.
3. Run the complete Rust/frontend test suites, TypeScript check, production
   build, formatting, and diff/security review.

## Deliberate boundaries

- No prebuilt base image.
- No forced command timeout.
- No broad host filesystem scan or unlabelled container deletion.
- Network package access remains available; host/private-network access is
  denied or the sandbox fails closed when policy cannot be verified.
