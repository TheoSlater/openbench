# Dev observability implementation plan

Design: `docs/superpowers/specs/2026-08-10-dev-observability-design.md`

## 1. Harden the existing frontend sink

- Extend `src/features/debug-overlay/devLog.ts` with bounded, recursive
  redaction and summaries for errors, arrays, binary-like data, secrets, and
  content-bearing keys.
- Gate new logging on the Vite `DEV` build flag; keep the debug overlay store
  responsible only for showing the overlay.
- Preserve the raw Tauri import only inside the sink so `debug_log` forwarding
  cannot recurse.
- Update the existing dev-log tests for build gating, redaction, bounds, and
  forwarding failures.

## 2. Add the frontend Tauri bridge

- Add a small wrapper for Tauri `invoke` and `listen` that records start,
  success, failure, subscription, and sampled event metadata.
- Extract request IDs from existing argument shapes without logging argument
  values; summarize result shapes and durations.
- Route all app-owned `invoke` and `listen` imports through the wrapper,
  including AI transport, startup, dictation, PTY, mobile, updater, settings,
  and debug overlay paths. Leave injected test bridges intact.
- Install one early listener for Rust `dev-log` events and render remote
  records to the original browser console without forwarding them back.

## 3. Cover frontend-owned boundaries

- Add lifecycle records to `RuntimeTransportManager` for listener readiness,
  stream open/cancel, chunk counts, done/error, and unknown/late events.
- Add sampled PTY/sandbox records to `src/features/viewport/aiTerminal.ts`:
  start, attach, status, exit, reset, close, relay byte counts, and failures.
- Replace app-owned direct diagnostic `console.*` calls with `devLog` so their
  terminal mirror is consistent; leave tests and third-party output alone.
- Log repository initialization/retry outcomes and notification errors where
  no wrapped Tauri boundary exists.

## 4. Bridge Rust-originated diagnostics

- Extend `src-tauri/src/debug_overlay.rs` with a `dev-log` event payload and a
  helper that writes the same bounded record to the terminal and emits the
  event when an `AppHandle` is available.
- Keep `debug_log` as the frontend-to-terminal command and make it a no-op for
  non-debug builds.
- Add lifecycle calls at the existing AI sidecar supervisor seam for spawn,
  restart, writes, ready/result/error/done routing, shutdown, and pending
  request failure. Summarize protocol records rather than serializing them.
- Add only missing PTY/sandbox transitions; retain existing startup-file
  diagnostics and avoid duplicating every low-level sample.

## 5. Add dev-only sidecar lifecycle records

- Add an `info` sidecar log level and a debug-build environment flag supplied
  by the Rust supervisor.
- In `sidecar/src/server.ts`, log command type/request lifecycle, approvals,
  model discovery, generation/agent completion, parse failures, PTY relay
  summaries, and shutdown. Do not log prompts, messages, paths, commands,
  output, secrets, or provider response bodies.
- Keep log records on the existing JSONL protocol and use `encodeRecord` plus
  secret replacement for the final serialization.
- Add focused sidecar tests proving lifecycle records are bounded and cannot
  expose known secret values or content fields.

## 6. Verify and hand off

- Run focused frontend tests first, then sidecar typecheck/tests, TypeScript
  build, Rust tests/checks for touched modules, and `git diff --check`.
- Re-scan imports for direct app-owned Tauri `invoke`/`listen` and diagnostic
  `console.*` bypasses.
- Run the full `bun run test` suite and `bun run build`.
- If a connected Tauri/browser session is available, exercise startup, one
  command, one AI request, one PTY action, and one failure; otherwise report
  that live console/terminal smoke was not performed.
