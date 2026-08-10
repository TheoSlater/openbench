import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauriBridge";
import { destroyAiSandbox } from "@/lib/ai/transport";
import { closePty } from "./pty";
import { openAiTerminalTab } from "./viewportStore";
import { devLog } from "@/features/debug-overlay/devLog";

export type PtyEvent = {
  kind: "data" | "exit" | "error" | "status";
  data?: number[];
  message?: string;
  exitCode?: number | null;
};

export type AiTerminalHistoryEntry = {
  toolCallId: string;
  sandboxId: string;
  command: string;
  cwd?: string;
  startedAt: number;
  durationMs?: number;
  exitCode?: number | null;
  status: "running" | "exited" | "failed" | "reset";
};

export type AiTerminalSession = {
  toolCallId: string;
  sandboxId: string;
  command: string;
  cwd?: string;
  /** Set once the host PTY session exists; input is only sent once attached. */
  ptyId: string | null;
  /** Every PTY event so far, replayed when the viewport attaches. */
  events: PtyEvent[];
  /** Latest runner startup or execution step shown by the viewport. */
  status?: string;
  error?: string;
  startedAt: number;
  durationMs?: number;
  exitCode?: number | null;
  history: AiTerminalHistoryEntry[];
  resetting: boolean;
  done: boolean;
};

export type SandboxDiagnostics = {
  sandboxId: string;
  state: string;
  runtime: string;
  capabilities: string[];
  workspaceBytes: number;
  workspaceLimitBytes: number;
  networkPolicy: string;
  activeCommands: number;
  lastActivityAgeMs: number;
};

type Listener = (session: AiTerminalSession) => void;

const listeners = new Set<Listener>();
const sessions = new Map<string, AiTerminalSession>();
const history: AiTerminalHistoryEntry[] = [];
let current: AiTerminalSession | null = null;
const MAX_HISTORY = 50;
const MAX_OUTPUT_BYTES = 100_000;

function historyEntry(session: AiTerminalSession): AiTerminalHistoryEntry {
  return {
    toolCallId: session.toolCallId,
    sandboxId: session.sandboxId,
    command: session.command,
    cwd: session.cwd,
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    exitCode: session.exitCode,
    status: session.error
      ? "failed"
      : session.resetting
        ? "reset"
        : session.done
          ? "exited"
          : "running",
  };
}

function syncHistory(session: AiTerminalSession): void {
  const next = historyEntry(session);
  const index = history.findIndex((entry) => entry.toolCallId === session.toolCallId);
  if (index < 0) history.push(next);
  else history[index] = next;
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

/** Emits a fresh snapshot so React sees a new object identity each update. */
function emit(session: AiTerminalSession): void {
  if (current !== session) return;
  syncHistory(session);
  const snapshot: AiTerminalSession = {
    ...session,
    events: [...session.events],
    history: history.map((entry) => ({ ...entry })),
  };
  for (const listener of listeners) listener(snapshot);
}

/**
 * Subscribes to the AI terminal session. Fires immediately with the current
 * session if one exists (a terminal window opened after the command started
 * still shows it live).
 */
export function subscribeAiTerminal(listener: Listener): () => void {
  listeners.add(listener);
  if (current) {
    listener({
      ...current,
      events: [...current.events],
      history: history.map((entry) => ({ ...entry })),
    });
  }
  return () => listeners.delete(listener);
}

export function getAiTerminalSession(): AiTerminalSession | null {
  return current
    ? { ...current, events: [...current.events], history: history.map((entry) => ({ ...entry })) }
    : null;
}

export function getAiTerminalOutput(): string {
  if (!current) return "";
  const bytes = current.events
    .filter((event) => event.kind === "data" && event.data)
    .flatMap((event) => event.data ?? []);
  return new TextDecoder().decode(Uint8Array.from(bytes)).slice(-MAX_OUTPUT_BYTES);
}

/** Clears sessions and dedupe state (used by tests and session cleanup). */
export function resetAiTerminalState(): void {
  sessions.clear();
  history.length = 0;
  current = null;
  seenToolCallIds.clear();
}

export async function stopAiCommand(): Promise<void> {
  const session = current;
  if (!session?.ptyId || session.done) return;
  devLog("debug", "ai-terminal", "Stopping command", {
    toolCallId: session.toolCallId,
    sandboxId: session.sandboxId,
  });
  session.status = "Stopping command…";
  emit(session);
  try {
    await invoke("sandbox_stop_processes", { sandboxId: session.sandboxId }).catch(() => undefined);
    await closePty(session.ptyId);
  } catch (error) {
    devLog("error", "ai-terminal", "Stop command failed", { error });
    session.error = String(error);
    session.done = true;
    session.durationMs = Date.now() - session.startedAt;
    emit(session);
  }
}

export async function resetAiSandbox(): Promise<void> {
  const session = current;
  if (!session) return;
  devLog("debug", "ai-terminal", "Resetting sandbox", { sandboxId: session.sandboxId });
  const ptyId = session.ptyId;
  session.resetting = true;
  session.done = true;
  session.status = "Resetting sandbox…";
  emit(session);
  if (ptyId) {
    try {
      await invoke("sandbox_stop_processes", { sandboxId: session.sandboxId }).catch(() => undefined);
      await closePty(ptyId);
    } catch {
      // The PTY may have exited between the button press and close.
    }
  }
  session.ptyId = null;
  try {
    await destroyAiSandbox(session.sandboxId);
    session.durationMs = Date.now() - session.startedAt;
    session.status = "Sandbox reset";
    emit(session);
  } catch (error) {
    devLog("error", "ai-terminal", "Sandbox reset failed", { error });
    session.error = String(error);
    session.status = "Sandbox reset failed";
    emit(session);
  }
}

/**
 * Spawns a host-restricted PTY session and relays captured output back to the
 * AI runtime keyed by the tool call id.
 */
export function runAiCommand(spec: {
  toolCallId: string;
  sandboxId: string;
  command: string;
  cwd?: string;
}): void {
  const session: AiTerminalSession = {
    toolCallId: spec.toolCallId,
    sandboxId: spec.sandboxId,
    command: spec.command,
    cwd: spec.cwd,
    ptyId: null,
    events: [],
    status: "Initializing host-restricted runner…",
    startedAt: Date.now(),
    history: [],
    resetting: false,
    done: false,
  };
  devLog("debug", "ai-terminal", "Command start", {
    toolCallId: spec.toolCallId,
    sandboxId: spec.sandboxId,
    command: spec.command,
    hasCwd: Boolean(spec.cwd),
  });
  sessions.set(spec.toolCallId, session);
  current = session;
  emit(session);
  openAiTerminalTab();

  const channel = new Channel<PtyEvent>();
  channel.onmessage = (event) => {
    if (session.resetting) return;
    if (event.kind === "status" && event.message) {
      session.status = event.message;
    }
    if (event.kind === "error" && event.message) {
      devLog("error", "ai-terminal", "PTY error", {
        toolCallId: session.toolCallId,
        message: event.message,
      });
      session.error = event.message;
      session.done = true;
      session.durationMs = Date.now() - session.startedAt;
      session.status = "Sandbox failed";
    }
    if (event.kind === "exit") {
      devLog("debug", "ai-terminal", "PTY exit", {
        toolCallId: session.toolCallId,
        exitCode: event.exitCode,
        durationMs: Date.now() - session.startedAt,
      });
      session.done = true;
      session.durationMs = Date.now() - session.startedAt;
      session.exitCode = event.exitCode;
      session.status =
        event.exitCode === undefined || event.exitCode === null
          ? "Command exited"
          : event.exitCode === 0
            ? "Command finished"
            : `Exited with code ${event.exitCode}`;
    }
    session.events.push(event);
    emit(session);
  };
  void invoke<string>("pty_spawn_command", {
    cols: 80,
    rows: 24,
    command: spec.command,
    cwd: spec.cwd ?? null,
    sandboxId: spec.sandboxId,
    relayRequestId: spec.toolCallId,
    onEvent: channel,
  })
    .then((ptyId) => {
      if (session.resetting) {
        void closePty(ptyId);
        return;
      }
      session.ptyId = ptyId;
      session.status = "Running command…";
      devLog("debug", "ai-terminal", "PTY attached", {
        toolCallId: session.toolCallId,
        ptyId,
      });
      emit(session);
    })
    .catch((error) => {
      devLog("error", "ai-terminal", "PTY spawn failed", {
        toolCallId: session.toolCallId,
        error,
      });
      session.done = true;
      session.error = String(error);
      session.durationMs = Date.now() - session.startedAt;
      session.status = "Sandbox failed";
      emit(session);
    });
}

type TerminalPart = {
  type: "data-terminal";
  id: string;
  data?: { kind?: "start"; command?: string; cwd?: string; sandboxId?: string };
};

const seenToolCallIds = new Set<string>();
const MAX_SEEN_TOOL_CALLS = 500;

/**
 * Forwards `data-terminal` parts from an AI chat stream to the terminal
 * window: opens the AI tab and spawns the command in its PTY. Dedupes so
 * repeated throttled message updates do not spawn twice.
 */
export function handleAiTerminalParts(parts: ReadonlyArray<{ type: string }>): void {
  for (const part of parts as readonly TerminalPart[]) {
    if (part.type !== "data-terminal" || !part.data) continue;
    if (seenToolCallIds.has(part.id)) continue;
    seenToolCallIds.add(part.id);
    if (seenToolCallIds.size > MAX_SEEN_TOOL_CALLS) {
      const oldest = seenToolCallIds.values().next().value;
      if (oldest !== undefined) seenToolCallIds.delete(oldest);
    }
    if (part.data.kind !== "start") continue;
    runAiCommand({
      toolCallId: part.id,
      sandboxId: part.data.sandboxId ?? part.id,
      command: part.data.command ?? "",
      cwd: part.data.cwd,
    });
  }
}
