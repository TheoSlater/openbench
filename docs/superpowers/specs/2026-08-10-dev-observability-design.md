# PolyUI dev observability

Date: 2026-08-10
Status: approved for implementation

## Goal

Make meaningful application activity visible in both the browser console and
the Tauri development terminal, while keeping release builds free of the new
instrumentation and never emitting credentials or user content.

## Logging contract

Every record has a source, operation, phase, and safe metadata. Phases are
`start`, `ok`, `error`, and `event`; request IDs and durations are included
when available. Frontend records are written to the browser console and
forwarded to the Rust `debug_log` command. Rust and sidecar records are
written to the terminal and forwarded to the frontend as a `dev-log` event.

The existing `devLog` helper remains the frontend sink. It is gated by the
Vite development build, not by the hidden debug-overlay UI toggle, so normal
development sessions are observable even when the overlay is closed.

Redaction is applied before either sink receives data. Never log prompts,
messages, audio samples, headers, credentials, tokens, shell commands,
command output, raw provider responses, or raw error payloads. Log only safe
shapes, counts, lengths, statuses, truncated identifiers, and durations.
Records are bounded in size. High-frequency streams are sampled or
aggregated; starts, finishes, failures, and dropped/late events remain
visible.

## Architecture

1. Add a frontend Tauri bridge that wraps `invoke` and `listen`. It logs
   command start/success/failure and event subscription/receipt, then delegates
   to the existing Tauri APIs. All app-owned direct imports are routed through
   this bridge; test seams that inject a bridge remain unchanged.
2. Extend `devLog` with safe structured-data serialization and a shared
   redaction/summarization routine. The forwarding call uses the raw Tauri
   `invoke` import so logging `debug_log` cannot recurse through the wrapper.
3. Extend the existing Rust debug-overlay logging seam with a dev-log event
   emitter. Frontend-originated records use `debug_log`; Rust-originated
   records use the event emitter plus terminal output. Remote records are
   rendered in the browser without being forwarded back to Rust.
4. Add lifecycle hooks at the existing AI sidecar, PTY/sandbox, and runtime
   transport seams. The sidecar continues to use JSONL stdout exclusively for
   protocol records; diagnostics are redacted log records, never raw stdout or
   stderr.

## Coverage

### Frontend

- startup phases, startup failures, global errors, and unhandled rejections;
- every Tauri `invoke` call, including command name, safe argument shape,
  result shape, duration, and failure;
- every Tauri event subscription and meaningful event receipt;
- AI stream open, listener readiness, cancel, chunk counts, done, error, and
  unknown/late events;
- PTY/sandbox start, attach, status, exit, reset, close, relay counts, and
  failures;
- repository initialization/retry outcomes and existing application error
  paths currently written directly with `console.*`;
- user-facing error notifications where no lower-level boundary exists.

High-rate audio meters, progress ticks, debug-overlay samples, and terminal
data chunks are summarized rather than logged one record per tick/byte.

### Rust/Tauri

- debug log forwarding and dev event emission;
- AI sidecar spawn, restart, write failure, record routing, shutdown, and
  pending-request failure;
- sandbox and PTY lifecycle transitions that are not visible through a
  frontend command result;
- existing startup, window, migration, dictation, and mobile diagnostics are
  retained and routed through the same dev terminal/browser sinks where an
  `AppHandle` is available.

### Bun sidecar

- command accepted/rejected, request start/end/error/cancel, approvals, model
  discovery, generation, agent lifecycle, and PTY relay summaries;
- provider and tool timings/statuses without request content, secrets, or
  tool output;
- protocol parse/size failures and shutdown.

## Data flow

```text
frontend action
  -> logged invoke/listen bridge
  -> browser console + debug_log
  -> Rust terminal

sidecar/Rust lifecycle
  -> redacted JSONL log record
  -> Rust terminal + dev-log Tauri event
  -> browser console
```

All records use the same source/operation/phase vocabulary and correlation
IDs where the existing request already provides one. No new telemetry service,
storage, dependency, or production logging path is introduced.

## Error handling

Logging must never change application behavior. Console serialization,
redaction, terminal forwarding, event emission, and listener setup are
best-effort and swallow their own failures. The wrapped operation always
resolves/rejects exactly as the underlying Tauri or sidecar operation would.

Unknown event payloads and malformed error values become bounded summaries.
Duplicate/late AI events are recorded as diagnostics but do not create a
stream controller or mutate application state.

## Verification

- Unit-test redaction, bounded summaries, event sampling, and invoke/listen
  lifecycle records.
- Preserve existing AI transport, debug-log, and sidecar protocol tests;
  extend them to prove secrets and content never reach either sink.
- Run `bun run test`, `bun run sidecar:typecheck`, `bun run build`, and focused
  Rust tests/checks for the touched modules.
- Run `git diff --check` and inspect the final import inventory to ensure
  app-owned direct Tauri `invoke`/`listen` and diagnostic `console.*` calls do
  not bypass the seams.
- A live browser/Tauri smoke is useful for confirming the terminal mirror, but
  it is not claimed unless the app is actually connected and exercised.

## Out of scope

- release-build logging or remote telemetry;
- logging every React render, state mutation, audio sample, token, prompt,
  message, command, or provider payload;
- replacing the existing debug overlay or adding a logging dependency.
