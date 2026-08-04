import { Channel, invoke } from "@tauri-apps/api/core";
import { openAiTerminalTab } from "./viewportStore";

export type PtyEvent = {
  kind: "data" | "exit" | "error";
  data?: number[];
  message?: string;
};

export type AiTerminalSession = {
  toolCallId: string;
  command: string;
  cwd?: string;
  /** Set once the host PTY session exists; input is only sent once attached. */
  ptyId: string | null;
  /** Every PTY event so far, replayed when the viewport attaches. */
  events: PtyEvent[];
  error?: string;
  done: boolean;
};

type Listener = (session: AiTerminalSession) => void;

const listeners = new Set<Listener>();
const sessions = new Map<string, AiTerminalSession>();
let current: AiTerminalSession | null = null;

/** Emits a fresh snapshot so React sees a new object identity each update. */
function emit(session: AiTerminalSession): void {
  const snapshot: AiTerminalSession = { ...session, events: [...session.events] };
  for (const listener of listeners) listener(snapshot);
}

/**
 * Subscribes to the AI terminal session. Fires immediately with the current
 * session if one exists (a terminal window opened after the command started
 * still shows it live).
 */
export function subscribeAiTerminal(listener: Listener): () => void {
  listeners.add(listener);
  if (current) listener({ ...current, events: [...current.events] });
  return () => listeners.delete(listener);
}

export function getAiTerminalSession(): AiTerminalSession | null {
  return current;
}

/** Clears sessions and dedupe state (used by tests and session cleanup). */
export function resetAiTerminalState(): void {
  sessions.clear();
  current = null;
  seenToolCallIds.clear();
}

/**
 * Spawns a real PTY session for the command: the host shell runs the command
 * in a proper terminal (visible to the user) and relays the captured output
 * back to the AI runtime keyed by the tool call id.
 */
export function runAiCommand(spec: {
  toolCallId: string;
  command: string;
  cwd?: string;
}): void {
  const session: AiTerminalSession = {
    toolCallId: spec.toolCallId,
    command: spec.command,
    cwd: spec.cwd,
    ptyId: null,
    events: [],
    done: false,
  };
  sessions.set(spec.toolCallId, session);
  current = session;
  emit(session);
  openAiTerminalTab();

  const channel = new Channel<PtyEvent>();
  channel.onmessage = (event) => {
    if (event.kind === "exit") session.done = true;
    session.events.push(event);
    emit(session);
  };
  void invoke<string>("pty_spawn_command", {
    cols: 80,
    rows: 24,
    command: spec.command,
    cwd: spec.cwd ?? null,
    relayRequestId: spec.toolCallId,
    onEvent: channel,
  })
    .then((ptyId) => {
      session.ptyId = ptyId;
      emit(session);
    })
    .catch((error) => {
      session.done = true;
      session.error = String(error);
      emit(session);
    });
}

type TerminalPart = {
  type: "data-terminal";
  id: string;
  data?: { kind?: "start"; command?: string; cwd?: string };
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
      command: part.data.command ?? "",
      cwd: part.data.cwd,
    });
  }
}
