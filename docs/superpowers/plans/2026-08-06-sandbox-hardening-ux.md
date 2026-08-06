# Implement sandbox hardening and terminal UX

> **For implementation:** execute this plan task-by-task. Keep the existing
> sandbox path, status callback, and async PTY startup intact. Do not add a
> prebuilt image.

**Goal:** make disposable AI sandboxes recoverable after crashes and easier to
control without weakening the host execution boundary.

**Approach:** add conservative orphan cleanup and cache hygiene in
`SandboxManager`, expose command lifecycle metadata/actions in the AI terminal,
and add a small preview toolbar. Keep long-running development servers valid;
the user can stop them explicitly.

## Task 1: Reap orphaned sandboxes and harden the host-tool cache

**Files:** `src-tauri/src/sandbox.rs`, `src-tauri/src/lib.rs`, sandbox tests.

1. Give every container labels `io.polyui.sandbox=true`, an app-instance owner
   label, and a creation timestamp. Keep the existing `--rm` behavior.
2. On manager startup, list only containers with the Poly labels. Remove
   stopped containers and remove running containers older than a conservative
   orphan TTL, excluding the current app owner. Never inspect or delete an
   unlabelled container.
3. Reap only exact `polyui-sandbox-*` workspace directories that are older
   than the same TTL and are not tracked by the current manager. Do not scan or
   delete arbitrary temporary files.
4. Make cache manifest writes atomic, set private permissions on the manifest
   and imported executable, reject architecture-mismatched entries, and evict
   oldest entries after a fixed cache-size cap.
5. Add a workspace-size guard before command execution. Return an actionable
   reset message after the configured soft limit; do not impose a command
   timeout that would kill a valid dev server.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sandbox
cargo check --manifest-path src-tauri/Cargo.toml
```

## Task 2: Expose terminal lifecycle metadata and controls

**Files:** `src-tauri/src/pty.rs`, `src/features/viewport/aiTerminal.ts`,
`src/features/viewport/components/AiTerminalViewport.tsx`, transport/store
tests.

1. Include optional exit code in PTY exit events while keeping human-terminal
   events compatible.
2. Track command start, duration, exit code, status, and bounded command
   history in the AI terminal state.
3. Add compact accessible controls: stop current command, reset sandbox,
   copy terminal output, and clear terminal output. Reset destroys the sandbox
   through the existing Tauri command and leaves the UI in a clear reset state.
4. Show the command, sandbox status, duration, and exit result in the terminal
   header. Keep bootstrap progress visible through the existing status shimmer.

Verification:

```bash
bun run test -- tests/viewportTerminal.test.ts tests/aiTerminalActions.test.ts
bun run build
```

## Task 3: Polish sandbox previews

**Files:** `src/features/viewport/components/SandboxPreviewViewport.tsx`,
`src/features/viewport/viewportStore.ts`, preview tests.

1. Add a small preview toolbar with reload, copy URL, and open-in-browser
   actions. Reuse installed Tauri opener and browser clipboard APIs.
2. Keep the preview iframe sandboxed; add only `allow-same-origin` required by
   normal dev-server behavior, with no top-navigation or unrestricted popups.
3. Preserve preview tabs across drawer switches and remove them when the
   sandbox-destroyed event arrives.

Verification:

```bash
bun run test -- tests/viewportStore.test.ts tests/viewportTerminal.test.ts
bun run build
```

## Task 4: Run focused verification

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
bun run test
bun run build
```

Review the diff for host-path mounts, host command execution, secret
environment forwarding, and unlabelled cleanup before handoff.

## Deliberate boundaries

- No prebuilt base image: bootstrap remains explicit and observable.
- No hard disk quota: the bind-mounted workspace cannot be portably quota'd
  across Docker and Podman; the command guard is the safe common denominator.
- No forced command wall-clock timeout: development servers are intentionally
  long-lived and have an explicit stop control.
- Network remains container-scoped bridge networking because package installs,
  git clones, and dev servers require egress. Host sockets, home directories,
  credentials, and secret environment variables remain unmounted/unforwarded.
