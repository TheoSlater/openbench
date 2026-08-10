import { describe, expect, it, vi } from "vitest";
import {
  getAiTerminalSession,
  handleAiTerminalParts,
  resetAiTerminalState,
  subscribeAiTerminal,
} from "../src/features/viewport/aiTerminal";
import {
  AI_TERMINAL_TAB_ID,
  useViewportStore,
} from "../src/features/viewport/viewportStore";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
  invoke: vi.fn(() => Promise.resolve("pty-1")),
}));

const { invoke } = await import("@tauri-apps/api/core");

const resetViewportStore = () => {
  useViewportStore.setState({
    tabs: [],
    activeTabId: null,
    drawerOpen: false,
    drawerWidth: 440,
  });
  resetAiTerminalState();
  vi.mocked(invoke).mockClear();
};

describe("AI terminal session bus", () => {
  beforeEach(resetViewportStore);

  it("spawns a PTY run from a start part and opens the AI tab", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAiTerminal((session) => seen.push(session.command));

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "c1",
      data: { kind: "start", command: "ls", cwd: "/tmp", sandboxId: "conv-1" },
    }]);
    await vi.waitFor(() => expect(seen).toEqual(["ls"]));
    unsubscribe();

    expect(invoke).toHaveBeenCalledWith("pty_spawn_command", expect.objectContaining({
      command: "ls",
      cwd: "/tmp",
      sandboxId: "conv-1",
      relayRequestId: "c1",
    }));
    const state = useViewportStore.getState();
    expect(state.tabs).toEqual([AI_TERMINAL_TAB_ID]);
    expect(state.drawerOpen).toBe(true);
  });

  it("passes a null cwd when the part has none", async () => {
    handleAiTerminalParts([{
      type: "data-terminal",
      id: "c2",
      data: { kind: "start", command: "pwd" },
    }]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("pty_spawn_command", expect.objectContaining({
      command: "pwd",
      cwd: null,
    }));
  });

  it("delivers relayed PTY events and marks the session done on exit", async () => {
    const sessions: Array<{ ptyId: string | null; done: boolean; events: unknown[] }> = [];
    const unsubscribe = subscribeAiTerminal((session) => sessions.push(session));

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "c3",
      data: { kind: "start", command: "echo hi" },
    }]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    const channel = vi.mocked(invoke).mock.calls[0]?.[1]?.onEvent;
    channel?.onmessage({ kind: "data", data: [104, 105] });
    channel?.onmessage({ kind: "exit" });
    await vi.waitFor(() => expect(sessions.at(-1)?.done).toBe(true));

    const last = sessions.at(-1);
    expect(last?.ptyId).toBe("pty-1");
    expect(last?.events.map((event) => event.kind)).toEqual(["data", "exit"]);
    unsubscribe();
  });

  it("shows sandbox startup status before the PTY attaches", async () => {
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeAiTerminal((session) => seen.push(session.status));

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "status-call",
      data: { kind: "start", command: "echo hi" },
    }]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    const channel = vi.mocked(invoke).mock.calls[0]?.[1]?.onEvent;
    channel?.onmessage({ kind: "status", message: "Using host-restricted runner…" });

    await vi.waitFor(() => expect(seen.at(-1)).toBe("Using host-restricted runner…"));
    unsubscribe();
  });

  it("keeps late events from an older command out of the current tab", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAiTerminal((session) => seen.push(session.toolCallId));

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "old-call",
      data: { kind: "start", command: "neofetch" },
    }]);
    await Promise.resolve();
    const oldChannel = vi.mocked(invoke).mock.calls[0]?.[1]?.onEvent;

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "new-call",
      data: { kind: "start", command: "echo hello world" },
    }]);
    await Promise.resolve();

    oldChannel?.onmessage({ kind: "data", data: [111, 108, 100] });
    oldChannel?.onmessage({ kind: "exit" });

    expect(getAiTerminalSession()?.toolCallId).toBe("new-call");
    expect(seen.at(-1)).toBe("new-call");
    unsubscribe();
  });

  it("surfaces spawn failures on the session", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("nope"));
    const seen: Array<{ error?: string; done: boolean }> = [];
    const unsubscribe = subscribeAiTerminal((session) => seen.push(session));

    handleAiTerminalParts([{
      type: "data-terminal",
      id: "c4",
      data: { kind: "start", command: "ls" },
    }]);
    await vi.waitFor(() => expect(seen.at(-1)?.error).toContain("nope"));
    expect(seen.at(-1)?.done).toBe(true);
    unsubscribe();
  });

  it("replays the current session to late subscribers", async () => {
    handleAiTerminalParts([{
      type: "data-terminal",
      id: "c5",
      data: { kind: "start", command: "git status" },
    }]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());

    const seen: string[] = [];
    const unsubscribe = subscribeAiTerminal((session) => seen.push(session.command));
    unsubscribe();
    expect(seen).toEqual(["git status"]);
  });

  it("ignores repeated parts for the same tool call", async () => {
    const part = {
      type: "data-terminal" as const,
      id: "repeat-call",
      data: { kind: "start" as const, command: "ls" },
    };
    handleAiTerminalParts([part]);
    handleAiTerminalParts([part]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("ignores unrelated parts", () => {
    handleAiTerminalParts([{ type: "text", text: "hello" }]);
    expect(useViewportStore.getState().tabs).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
