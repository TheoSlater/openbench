# Repository Guidelines

## Project Structure

PolyUI is a Tauri v2 desktop app with a React/TypeScript UI and Rust native services.

- `src/` contains UI, feature modules, Zustand stores, shared libraries, repositories, and generated bindings.
- `src-tauri/src/` contains thin Tauri commands plus SQLite migrations, connection/keychain services, memory, mobile, PTY, sandbox, and AI-sidecar supervision.
- `sidecar/src/` is the bundled Bun AI SDK runtime; `relay/` contains the optional mobile relay.
- `tests/` contains Vitest tests. `docs/` contains deeper architecture notes; `CONTEXT.md` is the domain glossary.

## Build, Test, and Development

```bash
bun install
bun run tauri dev                 # Tauri app, Vite HMR, and sidecar build
bun run build                     # sidecar build, TypeScript check, Vite build
bun run tauri build               # production installers
bun run test                      # all Vitest tests
bun run test -- tests/foo.test.ts # one test file
bun run sidecar:typecheck
bun run sidecar:test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Architecture and Data Flow

Chat uses `@ai-sdk/react` and `src/lib/ai/transport.ts`, which invoke `ai_runtime_*` Tauri commands. Rust authorizes requests, reads secrets from the OS keychain, and supervises the bundled sidecar over private JSONL stdin/stdout. The sidecar owns provider generation, streaming, tools, and Claude Code/Codex integration. Rust emits `ai-runtime-event`; one frontend listener fans out chunks by `request_id`.

SQLite is the source of truth for conversations. `src/lib/repositories/` owns the frontend repository seam, and `src/lib/ai/messages.ts` is the only AI SDK message-mapping boundary. Stores must not import one another; use `store/coordinator.ts` for cross-store effects.

## Security and Testing

Never put credentials in frontend state, browser storage, URLs, messages, or logs. Coding agents default to read-only; workspace writes require explicit mode selection and approval. The AI terminal uses the Rust host-restricted allowlisted runner—do not add Docker/Podman or arbitrary-shell fallback. `execute_sql` is disabled unless the `dev-sql-console` Cargo feature is enabled.

Vitest runs in Node without real Tauri/browser APIs; use repository injection seams or pure logic. Use `useShallow` for grouped Zustand selectors and keep lazy imports at route/modal boundaries.

## Commits and Pull Requests

Work on a feature branch; never commit directly to `main`. Prefer concise Conventional Commit prefixes such as `feat:`, `fix:`, and `docs:`. Keep PRs focused, include relevant tests, and describe user-visible or security-impacting changes; add screenshots for UI changes.
