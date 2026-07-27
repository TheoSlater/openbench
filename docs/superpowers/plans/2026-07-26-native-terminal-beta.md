# Native Terminal Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer Ghostty-backed wterm by default and xterm.js as an alternative renderer for a real native PTY, while retaining the browser-only Just Bash shell for internal use.

**Architecture:** Persist the terminal renderer and release-channel master toggles in the existing settings store. The user-facing choices are Ghostty-backed wterm (`native`) and xterm.js (`xterm`); Just Bash (`browser`) is not selectable. Both native renderers invoke the same small Tauri PTY API. Rust owns PTY sessions and streams output through a Tauri channel; closing either React component kills its process.

**Tech Stack:** React 19, Zustand, wterm with `@wterm/ghostty`, xterm.js, Tauri v2 channels, Rust, portable-pty.

## Global Constraints

- Native terminal is labeled Beta and only active when beta features are enabled.
- Browser shell remains default and fully offline.
- Preview features have a master toggle but no child features yet.
- Native PTY runs the user's normal shell and exposes native commands.
- No network or filesystem access is added to the browser shell.

---

### Task 1: Feature tiers and terminal preference

**Files:**
- Modify: `src/store/settingsStore.ts`
- Modify: `src/features/settings/tabs/AdvancedSettingsContent.tsx`
- Modify: `tests/settingsMerge.test.ts`
- Test: `tests/terminalSettings.test.ts`

**Interfaces:**
- Produces: `TerminalEmulator = "browser" | "native"`
- Produces: `general.betaFeatures`, `general.previewFeatures`, and `general.terminalEmulator`
- Consumes: existing `actions.updateGeneral`

- [ ] **Step 1: Write failing settings tests**

```ts
expect(defaults.general.betaFeatures).toBe(false);
expect(defaults.general.previewFeatures).toBe(false);
expect(defaults.general.terminalEmulator).toBe("browser");
expect(advancedSource).toContain("Enable beta features");
expect(advancedSource).toContain("Enable preview features");
expect(advancedSource).toContain("Terminal emulator");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bun run test -- tests/settingsMerge.test.ts tests/terminalSettings.test.ts`
Expected: FAIL because the three settings and controls do not exist.

- [ ] **Step 3: Add defaults and advanced controls**

```ts
export type TerminalEmulator = "browser" | "native";

betaFeatures: false,
previewFeatures: false,
terminalEmulator: "browser",
```

Render master switches for Experimental, Beta, and Preview. Render Memory and Terminal emulator under Beta; render Chromium under Experimental. Disable beta children when the Beta master is off.

- [ ] **Step 4: Run focused tests**

Run: `bun run test -- tests/settingsMerge.test.ts tests/terminalSettings.test.ts tests/memoryBeta.test.ts`
Expected: PASS.

---

### Task 2: xterm frontend and Tauri client

**Files:**
- Create: `src/features/viewport/components/NativeTerminalViewport.tsx`
- Create: `src/features/viewport/pty.ts`
- Modify: `src/features/viewport/components/TerminalViewport.tsx`
- Modify: `tests/viewportTerminal.test.ts`

**Interfaces:**
- Consumes: `general.betaFeatures` and `general.terminalEmulator`
- Produces: `startPty(cols, rows, onEvent)`, `writePty(id, data)`, `resizePty(id, cols, rows)`, `closePty(id)`

- [ ] **Step 1: Write failing terminal selection tests**

```ts
expect(terminalSource).toContain("<NativeTerminalViewport");
expect(terminalSource).toContain("betaFeatures");
expect(nativeSource).toContain('from "@xterm/xterm"');
expect(nativeSource).toContain("startPty");
```

- [ ] **Step 2: Run test and verify failure**

Run: `bun run test -- tests/viewportTerminal.test.ts`
Expected: FAIL because native terminal files do not exist.

- [ ] **Step 3: Add xterm component**

Create xterm `Terminal`, load `FitAddon`, open it in a visible container, forward `onData` to `pty_write`, forward resize events to `pty_resize`, write channel output into xterm, and call `pty_close` during cleanup.

- [ ] **Step 4: Select emulator**

```tsx
return betaFeatures && terminalEmulator === "native"
  ? <NativeTerminalViewport />
  : <BrowserTerminalViewport />;
```

- [ ] **Step 5: Run focused frontend tests**

Run: `bun run test -- tests/viewportTerminal.test.ts`
Expected: PASS.

---

### Task 3: Native PTY backend

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/pty.rs`

**Interfaces:**
- Produces commands:
  - `pty_spawn(cols: u16, rows: u16, on_event: Channel<PtyEvent>) -> Result<String, String>`
  - `pty_write(state, id: String, data: String) -> Result<(), String>`
  - `pty_resize(state, id: String, cols: u16, rows: u16) -> Result<(), String>`
  - `pty_close(state, id: String) -> Result<(), String>`
- `PtyEvent`: `{ kind: "data" | "exit" | "error", data?: string }`

- [ ] **Step 1: Write failing Rust tests**

```rust
#[test]
fn rejects_zero_sized_terminals() {
    assert!(validate_size(0, 24).is_err());
    assert!(validate_size(80, 0).is_err());
}
```

- [ ] **Step 2: Run test and verify failure**

Run: `cargo test pty --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because `pty` module does not exist.

- [ ] **Step 3: Implement PTY state and commands**

Use `portable_pty::native_pty_system()`, `PtySize`, and `CommandBuilder::new_default_prog()`. Store the master, writer, and child per UUID in `PtyState`. Read blocking PTY output on a dedicated thread and send it over the Tauri channel.

- [ ] **Step 4: Register state and commands**

```rust
.manage(pty::PtyState::default())
```

Add `pty_spawn`, `pty_write`, `pty_resize`, and `pty_close` to `generate_handler!`.

- [ ] **Step 5: Run Rust tests**

Run: `cargo test pty --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

---

### Task 4: Dependency and regression verification

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Adds: `@xterm/xterm`, `@xterm/addon-fit`, `portable-pty`

- [ ] **Step 1: Install frontend dependencies**

Run: `bun add @xterm/xterm @xterm/addon-fit`
Expected: Bun updates `package.json` and `bun.lock`.

- [ ] **Step 2: Add Rust dependency**

Run: `cargo add portable-pty@0.9 --manifest-path src-tauri/Cargo.toml`
Expected: Cargo updates `Cargo.toml` and `Cargo.lock`.

- [ ] **Step 3: Run full frontend verification**

Run: `bun run test && bun run build`
Expected: all tests pass and Vite exits 0.

- [ ] **Step 4: Run backend verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass.

- [ ] **Step 5: Check diff**

Run: `git diff --check`
Expected: no output.
