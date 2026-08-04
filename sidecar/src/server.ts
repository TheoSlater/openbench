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
import { closeAgentProviders, streamAgent } from "./agents";
import { ApprovalBroker } from "./approvals";
import { ptyBroker } from "./terminal";

export type RuntimeServerDeps = {
  createModel?: typeof createModel;
  listModels?: typeof listModels;
  streamChat?: typeof streamChat;
  streamAgent?: typeof streamAgent;
  write: (record: RuntimeRecord, secrets?: string[]) => void;
};

export class RuntimeServer {
  private readonly active = new Map<string, AbortController>();
  private readonly makeModel: typeof createModel;
  private readonly discoverModels: typeof listModels;
  private readonly runChat: typeof streamChat;
  private readonly runAgent: typeof streamAgent;
  private readonly approvals: ApprovalBroker;
  private stopped = false;

  constructor(private readonly deps: RuntimeServerDeps) {
    this.makeModel = deps.createModel ?? createModel;
    this.discoverModels = deps.listModels ?? listModels;
    this.runChat = deps.streamChat ?? streamChat;
    this.runAgent = deps.streamAgent ?? streamAgent;
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
    if (this.stopped && command.type !== "shutdown") {
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
        if (!this.approvals.resolve(
          command.requestId,
          command.approvalId,
          command.approved,
          command.reason,
        )) throw new Error("No approval is pending");
        return;
      case "pty-data":
        ptyBroker.append(command.requestId, new Uint8Array(command.payload.data));
        return;
      case "pty-exit":
        ptyBroker.finish(command.requestId, command.payload.exitCode);
        return;
      case "list-models":
        await this.withRequest(command.requestId, [command.connection.secret], async (signal) => {
          const result = await this.discoverModels(command.connection, ((input, init) =>
            fetch(input, { ...init, signal: init?.signal ?? signal })) as typeof fetch);
          this.deps.write({ type: "result", requestId: command.requestId, result });
        });
        return;
      case "validate":
        await this.withRequest(command.requestId, [command.connection.secret], async () => {
          const models = await this.discoverModels(command.connection);
          this.deps.write({
            type: "result",
            requestId: command.requestId,
            result: { ok: true, modelCount: models.length },
          });
        });
        return;
      case "generate":
        await this.withRequest(command.requestId, [command.connection.secret], async (signal) => {
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
        this.stopped = true;
        for (const controller of this.active.values()) controller.abort("shutdown");
        this.active.clear();
        await closeAgentProviders();
    }
  }

  private startAgent(command: Extract<RuntimeCommand, { type: "agent" }>): void {
    if (this.active.has(command.requestId)) {
      throw new Error(`Duplicate request id: ${command.requestId}`);
    }
    const controller = new AbortController();
    this.active.set(command.requestId, controller);
    void (async () => {
      try {
        const stream = await this.runAgent(command, controller.signal, {
          approvals: this.approvals,
        });
        const reader = stream.getReader();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          this.deps.write({ type: "chunk", requestId: command.requestId, chunk: next.value });
        }
      } catch (error) {
        this.deps.write({
          type: "error",
          requestId: command.requestId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } finally {
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
    const secrets = [command.connection.secret, command.webSearch?.secret];
    void (async () => {
      try {
        const stream = await this.runChat(command, controller.signal);
        const reader = stream.getReader();
        let text = "";
        while (true) {
          const next = await reader.read();
          if (next.done) break;
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
        this.deps.write({
          type: "error",
          requestId: command.requestId,
          error: error instanceof Error ? error : new Error(String(error)),
        }, secrets.filter((secret): secret is string => Boolean(secret)));
      } finally {
        this.active.delete(command.requestId);
        this.deps.write({ type: "done", requestId: command.requestId });
      }
    })();
  }

  private async withRequest(
    requestId: string,
    secrets: Array<string | undefined>,
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.active.has(requestId)) throw new Error(`Duplicate request id: ${requestId}`);
    const controller = new AbortController();
    this.active.set(requestId, controller);
    try {
      await work(controller.signal);
    } catch (error) {
      this.deps.write({
        type: "error",
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      }, secrets.filter((secret): secret is string => Boolean(secret)));
    } finally {
      this.active.delete(requestId);
    }
  }
}

export async function serve(): Promise<void> {
  const write = (record: RuntimeRecord, secrets: string[] = []) => {
    process.stdout.write(`${encodeRecord(record, secrets)}\n`);
  };
  const server = new RuntimeServer({ write });
  write({ type: "ready" });
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
