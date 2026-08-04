import { tool } from "ai";
import { z } from "zod";
import type { UIMessageChunk } from "ai";

export type TerminalResult = {
  command: string;
  cwd?: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
  truncated: boolean;
};

/** Combined output cap kept so a noisy command cannot flood the model. */
const MAX_OUTPUT_CHARS = 100_000;

/** How long the AI waits for the terminal session to be attached and run. */
const DEFAULT_SPAWN_TIMEOUT_MS = 30_000;

/** Upper bound on finished-but-unawaited sessions kept for late registration. */
const MAX_COMPLETED_SESSIONS = 100;

type PendingRun = {
  command: string;
  cwd: string | undefined;
  buffers: string[];
  outputChars: number;
  truncated: boolean;
  startedAt: number;
  resolve: (result: TerminalResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
/**
 * Collects PTY output for a single tool call. The command itself does not run
 * in this process: the host opens the app's real terminal (PTY), shows it in
 * the xterm tab, and relays captured output back here as `pty-data` /
 * `pty-exit` protocol commands keyed by the tool's `toolCallId`.
 */
export class PtyBroker {
  private readonly pending = new Map<string, PendingRun>();
  /** Relay data that arrived before the tool registered its run. */
  private readonly buffered = new Map<string, string[]>();
  private readonly completed = new Map<string, { text: string; exitCode: number | null; truncated: boolean }>();
  private bufferedChars = 0;

  get pendingCount(): number {
    return this.pending.size;
  }

  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  append(requestId: string, data: Uint8Array): void {
    const text = new TextDecoder().decode(data);
    const run = this.pending.get(requestId);
    if (run) {
      this.push(run, text);
      return;
    }
    const entry = this.buffered.get(requestId) ?? [];
    entry.push(text);
    this.buffered.set(requestId, entry);
    this.bufferedChars += text.length;
    while (this.bufferedChars > MAX_OUTPUT_CHARS * 2 && this.buffered.size > 1) {
      const oldest = this.buffered.keys().next().value;
      if (oldest === undefined) break;
      this.bufferedChars -= this.buffered.get(oldest)!.join("").length;
      this.buffered.delete(oldest);
    }
  }

  finish(requestId: string, exitCode: number | null): void {
    const run = this.pending.get(requestId);
    if (run) {
      this.pending.delete(requestId);
      clearTimeout(run.timer);
      let output = run.buffers.join("");
      if (run.truncated) output = output.slice(-MAX_OUTPUT_CHARS);
      run.resolve({
        command: run.command,
        cwd: run.cwd,
        exitCode,
        output,
        durationMs: Date.now() - run.startedAt,
        truncated: run.truncated,
      });
      return;
    }
    // The run has not registered yet: keep the session's output so a later
    // awaitRun can still resolve with the full result.
    const entry = this.buffered.get(requestId);
    this.dropBuffered(requestId);
    if (!entry) return;
    let text = entry.join("");
    const truncated = text.length > MAX_OUTPUT_CHARS;
    if (truncated) text = text.slice(-MAX_OUTPUT_CHARS);
    this.completed.set(requestId, { text, exitCode, truncated });
    while (this.completed.size > MAX_COMPLETED_SESSIONS) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) break;
      this.completed.delete(oldest);
    }
  }

  awaitRun(
    toolCallId: string,
    command: string,
    cwd: string | undefined,
    abortSignal?: AbortSignal,
    timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS,
  ): Promise<TerminalResult> {
    const done = this.completed.get(toolCallId);
    if (done) {
      this.completed.delete(toolCallId);
      return Promise.resolve({
        command,
        cwd,
        exitCode: done.exitCode,
        output: done.text,
        durationMs: 0,
        truncated: done.truncated,
      });
    }
    return new Promise<TerminalResult>((resolve, reject) => {
      const buffered = this.buffered.get(toolCallId);
      if (buffered) this.dropBuffered(toolCallId);
      const bufferedChars = buffered?.reduce((sum, part) => sum + part.length, 0) ?? 0;
      const timer = setTimeout(
        () => {
          this.pending.delete(toolCallId);
          reject(new Error(`Terminal session did not attach within ${timeoutMs}ms`));
        },
        timeoutMs,
      );
      const onAbort = () => {
        this.pending.delete(toolCallId);
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
        reject(new Error(abortSignal?.reason instanceof Error
          ? abortSignal.reason.message
          : String(abortSignal?.reason ?? "Aborted")));
      };
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(toolCallId, {
        command,
        cwd,
        buffers: buffered ?? [],
        outputChars: bufferedChars,
        truncated: bufferedChars > MAX_OUTPUT_CHARS,
        startedAt: Date.now(),
        resolve: (result) => {
          abortSignal?.removeEventListener("abort", onAbort);
          resolve(result);
        },
        reject: (error) => {
          abortSignal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer,
      });
    });
  }

  private push(run: PendingRun, text: string): void {
    run.buffers.push(text);
    run.outputChars += text.length;
    if (run.outputChars > MAX_OUTPUT_CHARS) run.truncated = true;
    while (run.outputChars - text.length > MAX_OUTPUT_CHARS && run.buffers.length > 1) {
      // Drop old chunks to bound memory; finish() slices the tail when truncated.
      const dropped = run.buffers.shift()!;
      run.outputChars -= dropped.length;
    }
  }

  private dropBuffered(requestId: string): void {
    const entry = this.buffered.get(requestId);
    if (!entry) return;
    this.buffered.delete(requestId);
    this.bufferedChars -= entry.reduce((sum, part) => sum + part.length, 0);
  }
}

export const ptyBroker = new PtyBroker();

export function createTerminalTool(options: { broker?: PtyBroker } = {}) {
  const broker = options.broker ?? ptyBroker;
  return tool({
    description: [
      "Run a shell command in the user's visible terminal window and return its",
      "output once the command exits.",
      "Use this when the user asks for filesystem inspection, builds, tests, package",
      "management, git, or any task that needs a command line.",
      "The command runs with the user's own permissions in a real terminal the user",
      "can watch and interrupt, so prefer read-only or safe commands unless the user",
      "explicitly asked for changes.",
      "The result includes the combined output, exit code, and duration.",
    ].join(" "),
    inputSchema: z.object({
      command: z.string().trim().min(1).max(2000),
      cwd: z.string().trim().min(1).max(1000).optional(),
    }),
    execute: async ({ command, cwd }, { toolCallId, abortSignal }) =>
      broker.awaitRun(toolCallId, command, cwd, abortSignal),
  });
}

export type TerminalTranscriptChunk = {
  type: "data-terminal";
  id: string;
  data: { kind: "start"; command: string; cwd?: string };
};

/**
 * Turns terminal tool activity into `data-terminal` chunks so the frontend
 * can open the terminal window and start the command in its PTY.
 */
export function withTerminalEvents(
  stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (chunk.type !== "tool-input-available" || chunk.toolName !== "terminal") return;
      const input = (chunk.input ?? {}) as { command?: unknown; cwd?: unknown };
      if (typeof input.command !== "string") return;
      const data: TerminalTranscriptChunk["data"] = { kind: "start", command: input.command };
      if (typeof input.cwd === "string") data.cwd = input.cwd;
      controller.enqueue({ type: "data-terminal", id: chunk.toolCallId, data });
    },
  }));
}
