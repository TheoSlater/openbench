# Coding-agent and Connections Fix Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct persisted coding-agent readiness, split installation/auth/runtime state, move setup inline, remove seeded Connections UI, and harden ACP child-process ownership without replacing the landed ACP architecture.

**Architecture:** Keep existing Rust ACP host, vendor detection modules, Tauri commands, generated bindings, and shared React coding-agent component. Persist one complete verification snapshot per agent, keep executable and availability caches process-local and explicitly invalidated, derive card state only in Rust, and let React render that decision. Reuse existing shadcn primitives and connection repository.

**Tech Stack:** Rust, Tauri v2, SQLite/sqlx, `agent-client-protocol` 2.0, React 19, TypeScript, Zustand, shadcn/radix, Vitest.

## Global Constraints

- Spawn plus initialize timeout is 10 seconds; ACP authenticate timeout is 10 minutes.
- Supported packages are `@agentclientprotocol/codex-acp` and `@agentclientprotocol/claude-agent-acp`; never install deprecated Zed packages.
- Accept `claude-code-acp` only for legacy discovery.
- Minimum adapter versions are constants; bump only for a published version fixing a Poly-breaking defect.
- Strict versions require exactly `major.minor.patch`; partial and prerelease versions fail closed.
- Cached card reads never spawn; cache invalidation is explicit, never TTL-based.
- Parent environment wins over runtime configuration.
- No authorize URL, credential, callback, token, protocol key, or raw protocol error appears in UI.
- Coding-agent workspace is selected during conversation creation; never default a live coding-agent session to Poly UI's directory.
- Existing dirty worktree changes are preserved; no architecture restart and no Poly Agent restoration.

---

### Task 1: Persist complete verification and paint from cache

**Files:**
- Modify: `src-tauri/src/db/migrations/20260728000000_agent_verification.sql`
- Modify: `src-tauri/src/acp/verification.rs`
- Modify: `src-tauri/src/commands/codex_commands.rs`
- Modify: `src-tauri/src/commands/claude_commands.rs`
- Modify: `src-tauri/src/codex/setup.rs`
- Modify: `src-tauri/src/claude/setup.rs`
- Test: `src-tauri/src/acp/verification.rs`
- Test: `tests/codingAgentSetup.test.tsx`

**Interfaces:**
- Produces: `AgentVerification { installation, authentication, verified_at, auth_checked_at }`.
- Produces: explicit installation `Unknown | NotInstalled | CliMissing | AdapterMissing | AdapterOutdated | Available`.
- Consumes: vendor detection only during explicit refresh/full verification, never during cached status paint.

- [ ] **Step 1: Write failing persisted-first-paint tests**

```rust
#[tokio::test]
async fn complete_snapshot_round_trips() {
    let pool = pool().await;
    let saved = fixture_verification();
    store(&pool, &saved).await.unwrap();
    assert_eq!(load(&pool, saved.agent_kind).await.unwrap(), Some(saved));
}
```

```tsx
it("stored ready paints READY without detection or verify", async () => {
  renderSetup({ status: ready, refreshDetection, verify });
  await screen.findByText("READY");
  expect(refreshDetection).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun run test -- tests/codingAgentSetup.test.tsx`
Expected: FAIL because mount refresh/detection and old state tags do not satisfy cached-first behavior.

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::verification`
Expected: FAIL because complete snapshot API does not exist.

- [ ] **Step 3: Implement minimum complete persisted record**

Store resolved paths, sources, CLI/adapter versions, installation state, authentication state/diagnostic, and independent timestamps. Make status load that record directly. Return `Unknown` when absent. Never downgrade because no check ran.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bun run test -- tests/codingAgentSetup.test.tsx`
Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::verification`
Expected: PASS.

### Task 2: Shared executable and availability caches

**Files:**
- Modify: `src-tauri/src/acp/resolve.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/adapter_install_commands.rs`
- Modify: `src-tauri/src/commands/codex_commands.rs`
- Modify: `src-tauri/src/commands/claude_commands.rs`
- Test: `src-tauri/src/acp/resolve.rs`
- Test: `src-tauri/src/commands/adapter_install_commands.rs`

**Interfaces:**
- Produces: command-keyed executable cache and read-only availability cache.
- Produces: one `invalidate_agent_caches(agent_kind)` path called after install.

- [ ] **Step 1: Write failing invalidation test**

```rust
#[test]
fn install_invalidation_exposes_new_binary() {
    let caches = AgentCaches::default();
    caches.record_missing("codex-acp");
    fixture.executable("codex-acp");
    caches.invalidate_all();
    assert!(resolve_cached(&caches, fixture.request("codex-acp")).is_ok());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml install_invalidation_exposes_new_binary`
Expected: FAIL because caches are vendor-local and not invalidated together.

- [ ] **Step 3: Implement shared caches and install invalidation**

Cache resolution by command and availability by agent. Cold availability reads return `Unknown` without subprocess work. Install completion clears both.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml install_invalidation_exposes_new_binary`
Expected: PASS.

### Task 3: Cheap auth probes and strict version probing

**Files:**
- Modify: `src-tauri/src/acp/resolve.rs`
- Create: `src-tauri/src/acp/probe.rs`
- Modify: `src-tauri/src/codex/mod.rs`
- Modify: `src-tauri/src/claude/mod.rs`
- Test: `src-tauri/src/acp/probe.rs`
- Test: `src-tauri/src/acp/resolve.rs`

**Interfaces:**
- Produces: `AuthenticationState::LoggedIn | LoggedOut | ConfigInvalid { diagnostic } | NotApplicable`.
- Produces: `parse_strict_version(&str) -> Option<(u64,u64,u64)>`.
- Uses augmented PATH for every child.

- [ ] **Step 1: Write failing probe/parser tests**

```rust
#[test]
fn config_parse_needs_both_signatures() {
    assert!(matches!(
        classify_auth_exit(1, "error loading configuration: unknown variant `x`"),
        AuthenticationState::ConfigInvalid { .. }
    ));
    assert_eq!(classify_auth_exit(1, "unknown variant"), AuthenticationState::LoggedOut);
}

#[test]
fn versions_fail_closed() {
    assert_eq!(parse_strict_version("1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_strict_version("1.2"), None);
    assert_eq!(parse_strict_version("1.2.0-rc1"), None);
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::probe`
Expected: FAIL because probe module does not exist.

- [ ] **Step 3: Implement bounded file-backed probes**

Run vendor status commands with augmented PATH. Redirect version/auth probe stdout and stderr to temporary regular files, wait at most 10 seconds, then read bounded contents. Classify exit code and conservative config signatures.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::probe acp::resolve`
Expected: PASS, including descendant-inherits-stdout fixture.

### Task 4: Initialize capabilities and ACP authenticate

**Files:**
- Modify: `src-tauri/src/acp/host.rs`
- Modify: `src-tauri/src/acp/capabilities.rs`
- Modify: `src-tauri/src/commands/acp_commands.rs`
- Modify: `src-tauri/src/acp/error.rs`
- Modify: `src-tauri/src/bin/mock_acp_agent.rs`
- Test: `src-tauri/src/acp/host_tests.rs`
- Test: `src-tauri/src/acp/capabilities.rs`

**Interfaces:**
- Produces: initialize request with `clientCapabilities.auth.terminal = true` and `_meta["terminal-auth"] = true`.
- Produces: advertised auth methods with interaction type retained.
- Produces: `authenticate(conversation_id, method_id)` rejecting unadvertised ids, timing out at 10 minutes, and requiring successful re-initialize before readiness.

- [ ] **Step 1: Write failing capability and auth tests**

```rust
#[test]
fn initialize_advertises_terminal_auth() {
    let request = initialize_request();
    let json = serde_json::to_value(request).unwrap();
    assert_eq!(json["clientCapabilities"]["auth"]["terminal"], true);
    assert_eq!(json["_meta"]["terminal-auth"], true);
}

#[tokio::test]
async fn authenticate_rejects_unadvertised_method() {
    let error = host.authenticate("session", "invented").await.unwrap_err();
    assert!(matches!(error, AcpError::Protocol { .. }));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml initialize_advertises_terminal_auth authenticate_rejects_unadvertised_method`
Expected: FAIL because current initialize sends neither capability and host has no auth action.

- [ ] **Step 3: Implement minimal handshake/auth lifecycle**

Retain method type and order. Prefer no-interaction, then agent/browser, then other. Validate selected id against advertised list. Send ACP `authenticate`, allow cancellation, then stop and perform one fresh initialize; returned authenticate alone never writes Ready.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::host`
Expected: PASS.

### Task 5: Inline coding-agent setup cards

**Files:**
- Modify: `src/features/coding-agents/CodingAgentCard.tsx`
- Modify: `src/features/coding-agents/CodingAgentSetup.tsx`
- Delete: `src/features/coding-agents/CodingAgentSetupSheet.tsx`
- Modify: `src/features/coding-agents/setupCopy.ts`
- Modify: `src/features/codex/codexClient.ts`
- Modify: `src/features/claude/claudeClient.ts`
- Test: `tests/codingAgentSetup.test.tsx`

**Interfaces:**
- Consumes: Rust-owned combined display decision.
- Produces: same card component for both agents, fixed collapsed size, inline expanded phases.

- [ ] **Step 1: Replace old tests with failing state table tests**

```tsx
it.each([
  ["unknown", null, "skeleton"],
  ["ready", readyView(), "READY"],
  ["logged-out", loggedOutView(), "Sign in"],
  ["config-invalid", configInvalidView(), "Config error"],
  ["adapter-missing", adapterMissingView(), "Set up"],
])("%s renders one correct status", async (_name, view, expected) => {
  renderCard(view);
  expect(await findStatus(expected)).toBeTruthy();
});
```

- [ ] **Step 2: Verify RED**

Run: `bun run test -- tests/codingAgentSetup.test.tsx`
Expected: FAIL because old sheet, two-state auth, and setup button remain.

- [ ] **Step 3: Implement shared inline card**

Render logo, name, and one status element. Expand in place through `Checking`, `Installing CLI`, `Installing adapter`, `Starting`, `Signing in`; skip completed steps. Show exact install package/command behind one confirmation. Use one Sign in button, spinner, cancel, and headless empty-method CLI fallback only. Use Badge, Button, Card, Skeleton, Tooltip, and existing dialog confirmation.

- [ ] **Step 4: Verify GREEN**

Run: `bun run test -- tests/codingAgentSetup.test.tsx`
Expected: PASS.

### Task 6: Connections authored-only surface

**Files:**
- Modify: `src/features/settings/tabs/ConnectionsTab.tsx`
- Modify: `src/features/connections/presentation.ts`
- Modify: `src/features/connections/store.ts`
- Modify: `src-tauri/src/connections/repository.rs`
- Modify: `src-tauri/src/commands/connection_commands.rs`
- Test: `tests/connectionsUi.test.ts`
- Test: `tests/settingsPresentation.test.ts`

**Interfaces:**
- Produces: no cards for absent connections.
- Produces: one Add connection button and grouped cloud/local/custom picker.
- Produces: available/enabled model counts and small default enabled set.

- [ ] **Step 1: Write failing fresh-profile and count tests**

```ts
it("fresh profile has no connection cards", () => {
  expect(groupConnections([])).toEqual({ cloud: [], local: [], custom: [] });
});

it("separates discovered and enabled model counts", () => {
  expect(modelCounts([{ enabled: true }, { enabled: false }])).toEqual({
    available: 2,
    enabled: 1,
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `bun run test -- tests/connectionsUi.test.ts tests/settingsPresentation.test.ts`
Expected: FAIL because UI seeds provider cards and shows one configured count.

- [ ] **Step 3: Implement authored-only list and picker**

Delete seeded provider rows and seven add pills. Keep provider editor as separate component. Show `Add connection` plus one-line empty copy. Use Dialog + grouped Select/Command primitives; selection is visible in trigger. Display available and enabled separately.

- [ ] **Step 4: Verify GREEN**

Run: `bun run test -- tests/connectionsUi.test.ts tests/settingsPresentation.test.ts`
Expected: PASS.

### Task 7: Process hygiene and error taxonomy

**Files:**
- Modify: `src-tauri/src/acp/lifecycle.rs`
- Modify: `src-tauri/src/acp/error.rs`
- Modify: `src-tauri/src/acp/host.rs`
- Modify: `src-tauri/src/acp/registry.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/bin/mock_acp_agent.rs`
- Test: `src-tauri/src/acp/host_tests.rs`

**Interfaces:**
- Produces: Windows no-console launch and Job Object ownership.
- Produces: bounded protocol lines, captured stderr, process-group termination, PID receipts and startup sweep.
- Produces: request/idle/hard-turn/write/cancel-drain timeout variants, exited/protocol/agent-reported errors preserving numeric code.

- [ ] **Step 1: Write failing receipt and timeout tests**

```rust
#[tokio::test]
async fn spawn_writes_receipt_and_startup_sweeps_it() {
    let receipt = spawn_fixture_agent().await;
    assert!(receipt.path.exists());
    sweep_receipts(&receipt.directory).await.unwrap();
    assert!(!receipt.path.exists());
    assert!(!process_exists(receipt.pid));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::host_tests`
Expected: FAIL because PID receipts, bounded line normalization, and two timeout variants are absent.

- [ ] **Step 3: Implement minimum host hardening**

Apply Windows creation flags, preserve Job Object behavior, add Unix process groups, write receipts tagged by app instance and known executable, verify identity before startup sweep kill, cap protocol lines, preserve stderr tail, and add missing error variants. Never block indefinitely during stop.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml acp::host_tests`
Expected: PASS.

### Task 8: Workspace selection and live re-auth

**Files:**
- Modify: `src/features/chat/components/ChatWorkspace.tsx`
- Modify: `src/features/chat/components/ModelSelector.tsx`
- Modify: `src/features/acp/useAcpChat.ts`
- Modify: `src/lib/acp/errorMessage.ts`
- Modify: `src-tauri/src/commands/chat_commands.rs`
- Test: `tests/runtimeSelector.test.ts`
- Test: `tests/chatRuntimeEventNormalization.test.ts`

**Interfaces:**
- Produces: workspace required before coding-agent conversation creation.
- Produces: 401/re-auth agent errors normalized to re-sign-in action.

- [ ] **Step 1: Write failing workspace and expiry tests**

```ts
it("coding-agent creation rejects an absent workspace", () => {
  expect(resolveCodingWorkspace("")).toEqual({ ok: false, reason: "Choose a workspace" });
});

it("401 agent errors offer sign-in", () => {
  expect(normalizeAcpError({ code: 401, message: "expired" }).action).toBe("sign-in");
});
```

- [ ] **Step 2: Verify RED**

Run: `bun run test -- tests/runtimeSelector.test.ts tests/chatRuntimeEventNormalization.test.ts`
Expected: FAIL until missing workspace and re-auth are distinct.

- [ ] **Step 3: Implement required workspace and re-auth mapping**

Use existing directory picker and runtime selection seam. Never use process cwd. Normalize only conservative 401/re-auth signals to sign-in.

- [ ] **Step 4: Verify GREEN**

Run: `bun run test -- tests/runtimeSelector.test.ts tests/chatRuntimeEventNormalization.test.ts`
Expected: PASS.

### Task 9: Boundary generation, forbidden-text audit, and full verification

**Files:**
- Modify: `src/generated/bindings/*.ts` only through `ts-rs` generation.
- Test: full repository.

**Interfaces:**
- Consumes: all new Rust `TS` types.
- Produces: clean generated bindings with no drift.

- [ ] **Step 1: Format and regenerate**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`
Expected: exit 0.

Run: project `ts-rs` generation command discovered from `build.rs`/tests.
Expected: exit 0 and bindings match Rust types.

- [ ] **Step 2: Run static checks**

Run: `bun run build`
Expected: TypeScript and Vite production build pass.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: exit 0.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: exit 0.

- [ ] **Step 3: Run full tests**

Run: `bun run test`
Expected: all Vitest tests pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass.

- [ ] **Step 4: Audit forbidden text and binding drift**

Run: `rg -n -i 'oauth|authorize|client_id|api_key|token' src/features/coding-agents src/features/acp`
Expected: no non-comment hits.

Run: `git diff --check`
Expected: no whitespace errors.

### Task 10: Visual evidence

**Files:**
- Create: screenshot artifacts under the repository's existing screenshot location, if present.

**Interfaces:**
- Produces: default/narrow screenshots for each agent-card state, fresh Connections profile, and two cached READY restart first paints.

- [ ] **Step 1: Start app with fixtureable local state**

Run: `bun run tauri dev`
Expected: Tauri window opens.

- [ ] **Step 2: Capture required states**

Use app UI and existing fixture seams. Capture every card state at default and narrow widths plus fresh-profile Connections.

- [ ] **Step 3: Restart twice and capture first paint**

Persist both successful verifications, restart twice, and capture each first paint with both cards reading READY and no setup interaction.

- [ ] **Step 4: Record real-machine-only checklist without marking complete**

List: real Codex and Claude sign-in; both Claude adapter install shapes; headless sign-in; permission approve/deny; external adapter kill; app quit mid-run.

