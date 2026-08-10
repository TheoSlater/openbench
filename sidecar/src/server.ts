import { createInterface } from "node:readline";
import type { LanguageModel } from "ai";
import { createModel, listModels } from "./providers";
import {
  encodeRecord,
  parseCommand,
  type ChatCommand,
  type RuntimeCommand,
  type RuntimeRecord,
} from "./protocol";
import { generate, streamChat } from "./runtime";
import { closeAgentProviders, listAgentModels, streamAgent } from "./agents";
import { ApprovalBroker } from "./approvals";
import { ptyBroker } from "./terminal";

export type RuntimeServerDeps = {
  createModel?: typeof createModel;
  listModels?: typeof listModels;
  listAgentModels?: typeof listAgentModels;
  streamChat?: typeof streamChat;
  streamAgent?: typeof streamAgent;
  write: (record: RuntimeRecord, secrets?: string[]) => void;
  dev?: boolean;
};

function commandSummary(command: RuntimeCommand): string {
  const requestId = "requestId" in command ? command.requestId.slice(0, 16) : "-";
  if (command.type === "chat") {
    return `type=chat request_id=${requestId} messages=${command.messages.length} provider=${command.connection.provider}`;
  }
  if (command.type === "agent") {
    return `type=agent request_id=${requestId} kind=${command.agent.kind} messages=${command.messages.length}`;
  }
  return `type=${command.type} request_id=${requestId}`;
}

export class RuntimeServer {
  private readonly active = new Map<string, AbortController>();
  private readonly makeModel: typeof createModel;
  private readonly discoverModels: typeof listModels;
  private readonly discoverAgentModels: typeof listAgentModels;
  private readonly runChat: typeof streamChat;
  private readonly runAgent: typeof streamAgent;
  private readonly approvals: ApprovalBroker;
  private readonly dev: boolean;
  private stopped = false;

  constructor(private readonly deps: RuntimeServerDeps) {
    this.makeModel = deps.createModel ?? createModel;
    this.discoverModels = deps.listModels ?? listModels;
    this.discoverAgentModels = deps.listAgentModels ?? listAgentModels;
    this.runChat = deps.streamChat ?? streamChat;
    this.runAgent = deps.streamAgent ?? streamAgent;
    this.dev = deps.dev ?? false;
    this.approvals = new ApprovalBroker((event, requestId) => deps.write({
      type: "chunk",
      requestId,
      chunk: {
        type: "data-agent",
        id: event.approvalId,
        data: { ...event, requestId },
      },
    }));
  }

  get activeRequestCount(): number {
    return this.active.size;
  }

  async handle(command: RuntimeCommand): Promise<void> {
    this.log("debug", `command received ${commandSummary(command)}`);
    if (this.stopped && command.type !== "shutdown") {
      this.log("warn", `command rejected while shutting down type=${command.type}`);
      throw new Error("AI runtime is shutting down");
    }
    switch (command.type) {
      case "chat":
        this.startChat(command);
        return;
      case "agent":
        this.startAgent(command);
        return;
      case "cancel":
        this.active.get(command.requestId)?.abort("cancelled");
        this.approvals.cancel(command.requestId);
        return;
      case "approval":
        this.log("debug", `approval request_id=${command.requestId} approved=${command.approved}`);
        if (!this.approvals.resolve(
          command.requestId,
          command.approvalId,
          command.approved,
          command.reason,
        )) throw new Error("No approval is pending");
        return;
      case "pty-data":
        ptyBroker.append(command.requestId, new Uint8Array(command.payload.data));
        this.log("debug", `PTY data request_id=${command.requestId.slice(0, 16)} bytes=${command.payload.data.length} pending=${ptyBroker.pendingCount} buffered=${ptyBroker.bufferedCount}`);
        return;
      case "pty-exit":
        ptyBroker.finish(command.requestId, command.payload.exitCode);
        this.log("debug", `PTY exit request_id=${command.requestId.slice(0, 16)} exit_code=${command.payload.exitCode ?? "null"} pending=${ptyBroker.pendingCount} buffered=${ptyBroker.bufferedCount}`);
        return;
      case "list-models":
        this.startRequest(command.requestId, [command.connection.secret], async (signal) => {
          const result = await this.discoverModels(command.connection, ((input, init) =>
            fetch(input, { ...init, signal: init?.signal ?? signal })) as typeof fetch);
          this.deps.write({ type: "result", requestId: command.requestId, result });
        });
        return;
      case "agent-models":
        this.startRequest(command.requestId, [], async () => {
          const result = await this.discoverAgentModels(command.agent);
          this.deps.write({ type: "result", requestId: command.requestId, result });
        });
        return;
      case "validate":
        this.startRequest(command.requestId, [command.connection.secret], async (signal) => {
          const models = await this.discoverModels(command.connection, ((input, init) =>
            fetch(input, { ...init, signal: init?.signal ?? signal })) as typeof fetch);
          this.deps.write({
            type: "result",
            requestId: command.requestId,
            result: { ok: true, modelCount: models.length },
          });
        });
        return;
      case "generate":
        this.startRequest(command.requestId, [command.connection.secret], async (signal) => {
          const model: LanguageModel = await this.makeModel(command.connection);
          const result = await generate(
            model,
            command.prompt,
            command.instructions,
            signal,
          );
          this.deps.write({ type: "result", requestId: command.requestId, result });
        });
        return;
      case "shutdown":
        this.log("info", "shutdown requested");
        this.stopped = true;
        for (const controller of this.active.values()) controller.abort("shutdown");
        this.active.clear();
        await closeAgentProviders();
    }
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    secrets: string[] = [],
  ): void {
    if (!this.dev || this.stopped) return;
    this.deps.write({ type: "log", level, message }, secrets);
  }

  private startAgent(command: Extract<RuntimeCommand, { type: "agent" }>): void {
    if (this.active.has(command.requestId)) {
      throw new Error(`Duplicate request id: ${command.requestId}`);
    }
    const controller = new AbortController();
    this.active.set(command.requestId, controller);
    const startedAt = Date.now();
    let chunkCount = 0;
    this.log("info", `agent start request_id=${command.requestId.slice(0, 16)} kind=${command.agent.kind}`);
    void (async () => {
      try {
        const stream = await this.runAgent(command, controller.signal, {
          approvals: this.approvals,
        });
        const reader = stream.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          chunkCount += 1;
          this.deps.write({ type: "chunk", requestId: command.requestId, chunk: next.value });
        }
      } catch (error) {
        this.log("error", `agent error request_id=${command.requestId.slice(0, 16)}`);
        this.deps.write({
          type: "error",
          requestId: command.requestId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } finally {
        this.log("info", `agent done request_id=${command.requestId.slice(0, 16)} chunks=${chunkCount} duration_ms=${Date.now() - startedAt}`);
        this.approvals.cancel(command.requestId);
        this.active.delete(command.requestId);
        this.deps.write({ type: "done", requestId: command.requestId });
      }
    })();
  }

  private startChat(command: ChatCommand): void {
    if (this.active.has(command.requestId)) {
      throw new Error(`Duplicate request id: ${command.requestId}`);
    }
    const controller = new AbortController();
    this.active.set(command.requestId, controller);
    const secrets = [command.connection.secret, command.webSearch?.secret]
      .filter((secret): secret is string => Boolean(secret));
    const startedAt = Date.now();
    let chunkCount = 0;
    this.log("info", `chat start request_id=${command.requestId.slice(0, 16)} provider=${command.connection.provider} messages=${command.messages.length}`);
    void (async () => {
      try {
        const stream = await this.runChat(command, controller.signal);
        const reader = stream.getReader();
        let text = "";
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          chunkCount += 1;
          if (command.collectText && next.value.type === "text-delta") text += next.value.delta;
          this.deps.write(
            { type: "chunk", requestId: command.requestId, chunk: next.value },
            secrets.filter((secret): secret is string => Boolean(secret)),
          );
        }
        if (command.collectText) this.deps.write({
          type: "chunk",
          requestId: command.requestId,
          chunk: { type: "data-runtime-result", data: { text } },
        });
      } catch (error) {
        this.log("error", `chat error request_id=${command.requestId.slice(0, 16)}`, secrets);
        this.deps.write({
          type: "error",
          requestId: command.requestId,
          error: error instanceof Error ? error : new Error(String(error)),
        }, secrets.filter((secret): secret is string => Boolean(secret)));
      } finally {
        this.log("info", `chat done request_id=${command.requestId.slice(0, 16)} chunks=${chunkCount} duration_ms=${Date.now() - startedAt}`);
        this.active.delete(command.requestId);
        this.deps.write({ type: "done", requestId: command.requestId });
      }
    })();
  }

  private startRequest(
    requestId: string,
    secrets: Array<string | undefined>,
    work: (signal: AbortSignal) => Promise<void>,
  ): void {
    if (this.active.has(requestId)) throw new Error(`Duplicate request id: ${requestId}`);
    const controller = new AbortController();
    this.active.set(requestId, controller);
    const startedAt = Date.now();
    this.log("info", `request start request_id=${requestId.slice(0, 16)}`);
    void (async () => {
      try {
        await work(controller.signal);
      } catch (error) {
        this.log(
          "error",
          `request error request_id=${requestId.slice(0, 16)}`,
          secrets.filter((secret): secret is string => Boolean(secret)),
        );
        this.deps.write({
          type: "error",
          requestId,
          error: error instanceof Error ? error : new Error(String(error)),
        }, secrets.filter((secret): secret is string => Boolean(secret)));
      } finally {
        this.log("info", `request done request_id=${requestId.slice(0, 16)} duration_ms=${Date.now() - startedAt}`);
        this.active.delete(requestId);
      }
    })();
  }
}

export async function serve(): Promise<void> {
  const dev = process.env.POLYUI_DEV_LOGS === "1";
  const write = (record: RuntimeRecord, secrets: string[] = []) => {
    process.stdout.write(`${encodeRecord(record, secrets)}\n`);
  };
  const server = new RuntimeServer({ write, dev });
  write({ type: "ready" });
  if (dev) write({ type: "log", level: "info", message: "runtime server ready" });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 4 * 1024 * 1024) {
      write({ type: "log", level: "error", message: "Rejected oversized command" });
      continue;
    }
    try {
      const command = parseCommand(line);
      await server.handle(command);
      if (command.type === "shutdown") break;
    } catch (error) {
      write({
        type: "log",
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
