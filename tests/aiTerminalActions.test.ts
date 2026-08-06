import { describe, expect, it, vi } from "vitest";
import {
  getAiTerminalOutput,
  getAiTerminalSession,
  handleAiTerminalParts,
  resetAiSandbox,
  resetAiTerminalState,
  stopAiCommand,
} from "../src/features/viewport/aiTerminal";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
  invoke: vi.fn((command: string) =>
    Promise.resolve(command === "pty_spawn_command" ? "pty-actions" : undefined)),
}));

const { invoke } = await import("@tauri-apps/api/core");

describe("AI terminal actions", () => {
  beforeEach(() => {
    resetAiTerminalState();
    vi.mocked(invoke).mockClear();
  });

  it("keeps output and exit metadata for copy/history UI", async () => {
    handleAiTerminalParts([{
      type: "data-terminal",
      id: "actions-output",
      data: { kind: "start", command: "printf hi" },
    }]);
    await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "pty_spawn_command",
      expect.anything(),
    ));

    const channel = vi.mocked(invoke).mock.calls[0]?.[1]?.onEvent;
    channel?.onmessage({ kind: "data", data: [104, 105] });
    channel?.onmessage({ kind: "exit", exitCode: 0 });

    await vi.waitFor(() => expect(getAiTerminalSession()?.done).toBe(true));
    expect(getAiTerminalOutput()).toBe("hi");
    expect(getAiTerminalSession()?.exitCode).toBe(0);
    expect(getAiTerminalSession()?.history.at(-1)?.status).toBe("exited");
  });

  it("stops the active sandbox PTY", async () => {
    handleAiTerminalParts([{
      type: "data-terminal",
      id: "actions-stop",
      data: { kind: "start", command: "npm run dev" },
    }]);
    await vi.waitFor(() => expect(getAiTerminalSession()?.ptyId).toBe("pty-actions"));

    await stopAiCommand();

    expect(invoke).toHaveBeenCalledWith("sandbox_stop_processes", { sandboxId: "actions-stop" });
    expect(invoke).toHaveBeenCalledWith("pty_close", { id: "pty-actions" });
    expect(getAiTerminalSession()?.status).toBe("Stopping command…");
  });

  it("closes the PTY and destroys the sandbox on reset", async () => {
    handleAiTerminalParts([{
      type: "data-terminal",
      id: "actions-reset",
      data: { kind: "start", command: "pwd", sandboxId: "sandbox-actions" },
    }]);
    await vi.waitFor(() => expect(getAiTerminalSession()?.ptyId).toBe("pty-actions"));

    await resetAiSandbox();

    expect(invoke).toHaveBeenCalledWith("pty_close", { id: "pty-actions" });
    expect(invoke).toHaveBeenCalledWith("sandbox_destroy", { sandboxId: "sandbox-actions" });
    expect(getAiTerminalSession()?.status).toBe("Sandbox reset");
    expect(getAiTerminalSession()?.done).toBe(true);
  });
});
