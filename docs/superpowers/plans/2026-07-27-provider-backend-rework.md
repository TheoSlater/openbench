# Provider backend rework implementation plan

**Goal:** Route every direct chat provider through connection-backed Rust adapters with normalized events, cancellation, model refresh, and secret-safe errors.

**Constraints:** Reuse existing provider HTTP/request/SSE parsers and `ThinkingTagParser`. Keep obsolete code for checkpoint 8 with `// REWORK-REMOVE:`. No ACP or checkpoint-7 UI work.

## 1. Normalized adapter boundary

- Add Rust-owned chat runtime request/event/error/model types and `ts-rs` bindings.
- Add a bounded event sink whose backpressure is cancellation-aware.
- Test event serialization, bounded delivery, cancellation, and redaction before implementation.

## 2. Connection-backed providers

- Resolve a checkpoint-2 `Connection` plus keychain secret into the existing provider implementations.
- Keep all provider selection/request shaping inside the provider module.
- Expose validation, model listing, and streaming through one adapter trait.
- Add recorded/mock HTTP tests for validation, malformed model payloads, stream normalization, and cancellation.

## 3. Safe model refresh

- Add one transactional repository operation that refreshes discovered models.
- Preserve manual rows and their aliases/metadata; disable stale discovered rows.
- Test the manual/discovered conflict first.

## 4. Runtime integration

- Add a per-request cancellation registry to `AppState`.
- Route chat/title commands through conversation `RuntimeRef` and the adapter; remove the active selector path.
- Emit normalized runtime events through one bounded queue and drain task.
- Keep old selector/emitter code marked `// REWORK-REMOVE:`.
- Fix frontend listener ownership only where needed to prove conversation switching leaves no subscription.

## 5. Commands and verification

- Expose connection validation/model refresh commands without returning secrets.
- Generate TypeScript bindings from Rust.
- Run targeted tests after each slice, then formatter, frontend lint/typecheck/tests/build, `cargo check`, strict clippy, Rust tests, and production build.
