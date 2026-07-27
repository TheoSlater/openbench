import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const drawer = readFileSync(
  "src/features/viewport/components/ViewportDrawer.tsx",
  "utf8",
);
const drawerTab = readFileSync(
  "src/features/viewport/components/DrawerTab.tsx",
  "utf8",
);
const terminal = readFileSync(
  "src/features/viewport/components/TerminalViewport.tsx",
  "utf8",
);
const browserTerminal = readFileSync(
  "src/features/viewport/components/BrowserTerminalViewport.tsx",
  "utf8",
);
const nativeTerminal = existsSync(
  "src/features/viewport/components/NativeTerminalViewport.tsx",
)
  ? readFileSync(
      "src/features/viewport/components/NativeTerminalViewport.tsx",
      "utf8",
    )
  : "";
const ptyClient = existsSync("src/features/viewport/pty.ts")
  ? readFileSync("src/features/viewport/pty.ts", "utf8")
  : "";

describe("viewport terminal tab", () => {
  it("opens from the add menu and renders in the active viewport tab", () => {
    expect(drawer).toContain("openViewportTerminal");
    expect(drawer).toContain("New terminal tab");
    expect(drawer).toContain("<TerminalViewport");
  });

  it("gates the entire terminal feature behind beta features", () => {
    expect(drawer).toContain("state.general.betaFeatures");
    expect(drawer).toContain("closeViewport()");
    expect(drawer).toContain("betaFeatures ? (");
    expect(terminal).toContain("if (!betaFeatures) return null");
  });

  it("renders multiple ordered tabs with adjacent add and drag reordering", () => {
    expect(drawer).toContain("tabs.map");
    expect(drawer).toContain('from "motion/react"');
    expect(drawer).toContain("<Reorder.Group");
    expect(drawer).toContain("setViewportTabOrder");
    expect(drawer).toContain("New terminal tab");
    expect(drawerTab).toContain("<Reorder.Item");
    expect(drawerTab).toContain("onDragStart");
    expect(drawerTab).not.toContain("draggable");
  });

  it("connects terminal input to the browser Bash shell", () => {
    expect(browserTerminal).toContain('from "@wterm/just-bash"');
    expect(browserTerminal).toContain("shell.attach(write)");
    expect(browserTerminal).toContain("shellRef.current?.handleInput(data)");
  });

  it("loads only the emulator in use", () => {
    // Both engines are heavy and only one runs. Importing either eagerly puts
    // it in the drawer's chunk, which gates how fast the drawer can open.
    expect(terminal).toContain("lazy(() =>");
    expect(terminal).not.toContain('from "@wterm/just-bash"');
    expect(terminal).not.toContain('from "@xterm/xterm"');
  });

  it("selects the configured terminal emulator", () => {
    expect(terminal).toContain("betaFeatures");
    expect(terminal).toContain("terminalEmulator");
    expect(terminal).toContain("<NativeTerminalViewport");
    expect(nativeTerminal).toContain('from "@xterm/xterm"');
    expect(nativeTerminal).toContain("startPty");
    expect(ptyClient).toContain('invoke<string>("pty_spawn"');
    expect(ptyClient).toContain('invoke("pty_write"');
    expect(ptyClient).toContain('invoke("pty_resize"');
    expect(ptyClient).toContain('invoke("pty_close"');
  });
});
