# Claude Code ACP Implementation Plan

> **For agentic workers:** Execute inline with test-driven development. Do not start checkpoint 6 or 7 work.

**Goal:** Add Claude adapter detection, verification, advertised authentication, negotiated capability display, and setup UI through existing ACP host.

**Architecture:** Rust owns Claude detection/setup types and exports them with `ts-rs`. Claude commands reuse checkpoint 3 executable resolution, process registry, and ACP host. React consumes generated types and renders only negotiated auth methods and capabilities.

**Tech Stack:** Rust, Tauri v2, `agent-client-protocol` 2.0.0, React, TypeScript, Zustand, Vitest.

## Global Constraints

- Package: `@agentclientprotocol/claude-agent-acp`; executable: `claude-agent-acp`.
- npm shape requires Node.js; standalone shape does not.
- No terminal scraping, shell command construction, credential-file access, plaintext secret persistence, package-manager execution, capability simulation, empty workspace, or second protocol path.
- Readiness requires successful ACP initialize.
- Current README has no authentication section. Do not advertise subscription login.

---

### Task 1: Detection and launch

**Files:**
- Create: `src-tauri/src/claude/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `ClaudeSettings`, `ClaudeDetection`, `ClaudeInstallKind`, `NodeRequirement`, `detect`, `probe_versions`, `launch_options`.
- Consumes: `acp::resolve` and `acp::lifecycle::LaunchOptions`.

- [ ] Add fixture tests for absent, npm, standalone, override, non-executable override, and Node-only-for-npm behavior.
- [ ] Run `cargo test claude::tests` and confirm missing-module/API failure.
- [ ] Implement filesystem-only shape detection and shared-resolver lookup.
- [ ] Add workspace-validated launch options.
- [ ] Re-run `cargo test claude::tests`.

### Task 2: Setup states and commands

**Files:**
- Create: `src-tauri/src/claude/setup.rs`
- Create: `src-tauri/src/commands/claude_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `ClaudeSetupState`, `ClaudeSetupView`, cached status, refresh, verify, and authenticate Tauri commands.
- Consumes: `AgentDescriptor`, `AgentAuthMethod`, `AgentCapabilitySet`, and shared ACP host.

- [ ] Add Rust tests for installed/unverified, empty/advertised auth lists, reduced/full capabilities, failures, and primary actions.
- [ ] Run focused tests and confirm failures.
- [ ] Implement state derivation and cache-backed commands.
- [ ] Verify only explicit action spawns; stop verification/auth processes after use.
- [ ] Re-run focused tests.

### Task 3: Capability-driven setup UI

**Files:**
- Create: `src/features/claude/claudeClient.ts`
- Create: `src/features/claude/ClaudeSetupSection.tsx`
- Create: `tests/claudeSetup.test.ts`
- Modify: `src/features/settings/tabs/ConnectionsTab.tsx`
- Modify: `src/store/settingsStore.ts`

**Interfaces:**
- Consumes generated Claude bindings.
- Produces state-driven Claude setup UI with exactly one primary action, advertised auth buttons, and negotiated capability rows only.

- [ ] Add failing Vitest coverage for install state, npm/standalone source, empty/advertised auth lists, reduced capability list, and state transitions.
- [ ] Run `bun run test -- tests/claudeSetup.test.ts`.
- [ ] Implement client helpers and setup component.
- [ ] Add non-secret Claude settings/workspace defaults and Connections page integration.
- [ ] Re-run focused frontend tests.

### Task 4: Bindings and verification

**Files:**
- Modify: `tests/runtimeBindings.test.ts`
- Generate: `src/generated/bindings/Claude*.ts`, `ClaudeInstallKind.ts`, `NodeRequirement.ts`

- [ ] Extend binding expectations first and confirm failure.
- [ ] Generate bindings through Rust tests.
- [ ] Run formatting, frontend tests/build, `cargo test`, `cargo check`, `cargo clippy`, and production build.
- [ ] Report files, exclusions, contradictions, crossing types, and unchecked Theo manual checklist.
