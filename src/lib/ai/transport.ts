import { invoke, listen } from "@/lib/tauriBridge";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { devLog } from "@/features/debug-overlay/devLog";

export type RuntimeEvent =
  | { type: "chunk"; request_id: string; chunk: UIMessageChunk }
  | { type: "done"; request_id: string }
  | { type: "error"; request_id: string; error: string };

export interface RuntimeBridge {
  listen(listener: (event: RuntimeEvent) => void): Promise<() => void>;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

const tauriBridge: RuntimeBridge = {
  async listen(listener) {
    return listen<RuntimeEvent>("ai-runtime-event", ({ payload }) => listener(payload));
  },
  invoke: (command, args) => invoke(command, args),
};

export class RuntimeTransportManager {
  private readonly streams = new Map<string, ReadableStreamDefaultController<UIMessageChunk>>();
  private readonly chunkCounts = new Map<string, number>();
  private listener: Promise<void> | undefined;

  constructor(private readonly bridge: RuntimeBridge) {}

  async ready(): Promise<void> {
    this.listener ??= this.bridge.listen((event) => this.route(event)).then(() => {
      devLog("debug", "ai-transport", "runtime listener ready");
    });
    await this.listener;
  }

  open(requestId: string, sandboxId?: string): ReadableStream<UIMessageChunk> {
    if (this.streams.has(requestId)) throw new Error(`Duplicate AI request: ${requestId}`);
    this.chunkCounts.set(requestId, 0);
    devLog("debug", "ai-transport", "stream open", { requestId, sandboxId });
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        this.streams.set(requestId, controller);
      },
      cancel: () => this.cancel(requestId, sandboxId),
    });
  }

  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.bridge.invoke(command, args);
  }

  fail(requestId: string, error: unknown): void {
    const controller = this.streams.get(requestId);
    if (!controller) return;
    this.streams.delete(requestId);
    this.chunkCounts.delete(requestId);
    devLog("error", "ai-transport", "stream failed", { requestId, error });
    controller.error(error instanceof Error ? error : new Error(String(error)));
  }

  private route(event: RuntimeEvent): void {
    const controller = this.streams.get(event.request_id);
    if (!controller) {
      devLog("warn", "ai-transport", "late or unknown runtime event", {
        requestId: event.request_id,
        eventType: event.type,
      });
      return;
    }
    if (event.type === "chunk") {
      const count = (this.chunkCounts.get(event.request_id) ?? 0) + 1;
      this.chunkCounts.set(event.request_id, count);
      if (count === 1 || count % 50 === 0) {
        devLog("debug", "ai-transport", "stream chunk", {
          requestId: event.request_id,
          chunkCount: count,
          chunkType: event.chunk.type,
        });
      }
      controller.enqueue(event.chunk);
      return;
    }
    this.streams.delete(event.request_id);
    const chunkCount = this.chunkCounts.get(event.request_id) ?? 0;
    this.chunkCounts.delete(event.request_id);
    if (event.type === "error") {
      devLog("error", "ai-transport", "stream error", {
        requestId: event.request_id,
        chunkCount,
        error: event.error,
      });
      controller.error(new Error(event.error));
    } else {
      devLog("debug", "ai-transport", "stream done", {
        requestId: event.request_id,
        chunkCount,
      });
      controller.close();
    }
  }

  private async cancel(requestId: string, sandboxId?: string): Promise<void> {
    this.streams.delete(requestId);
    this.chunkCounts.delete(requestId);
    devLog("debug", "ai-transport", "stream cancel", { requestId, sandboxId });
    await this.bridge.invoke("ai_runtime_cancel", {
      requestId,
      ...(sandboxId ? { sandboxId } : {}),
    });
  }
}

export const aiRuntimeManager = new RuntimeTransportManager(tauriBridge);

export function destroyAiSandbox(sandboxId: string): Promise<void> {
  return invoke("sandbox_destroy", { sandboxId });
}

export type AgentTransport = {
  kind: "claude-code" | "codex";
  workspaceId: string;
  accessMode: "read-only" | "workspace-write";
  sessionId?: string;
  modelId?: string;
};

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "tool"; toolName: string };

type TransportOptions = {
  manager?: RuntimeTransportManager;
  requestId: string;
  responseMessageId?: string;
  conversationId: string;
  connectionId?: string;
  modelId?: string;
  agent?: AgentTransport;
  instructions?: string;
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  webSearchProvider?: "local" | "exa" | "ollama" | "tavily";
  terminalEnabled?: boolean;
  toolChoice?: ToolChoice;
  activeTools?: string[];
  toolOrder?: string[];
  token?: () => string | null;
};

export class TauriChatTransport<UI_MESSAGE extends UIMessage = UIMessage>
implements ChatTransport<UI_MESSAGE> {
  private readonly manager: RuntimeTransportManager;

  constructor(private readonly options: TransportOptions) {
    this.manager = options.manager ?? aiRuntimeManager;
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    devLog("debug", "ai-transport", "chat request start", {
      requestId: this.options.requestId,
      hasAgent: Boolean(this.options.agent),
      hasTools: Boolean(this.options.activeTools?.length),
    });
    const stream = this.manager.open(this.options.requestId, this.options.conversationId);
    await this.manager.ready();
    const abort = () => {
      void this.manager.invoke("ai_runtime_cancel", {
        requestId: this.options.requestId,
        sandboxId: this.options.conversationId,
      });
    };
    abortSignal?.addEventListener("abort", abort, { once: true });
    try {
      await this.manager.invoke("ai_runtime_start", {
        request: {
          requestId: this.options.requestId,
          responseMessageId: this.options.responseMessageId ?? null,
          conversationId: this.options.conversationId,
          connectionId: this.options.connectionId,
          modelId: this.options.modelId,
          agent: this.options.agent ?? null,
          messages,
          instructions: this.options.instructions ?? null,
          reasoning: this.options.reasoning ?? null,
          webSearchProvider: this.options.webSearchProvider ?? null,
          terminal: this.options.terminalEnabled ?? null,
          toolChoice: this.options.toolChoice ?? null,
          activeTools: this.options.activeTools ?? null,
          toolOrder: this.options.toolOrder ?? null,
        },
        token: this.options.token?.() ?? null,
      });
    } catch (error) {
      devLog("error", "ai-transport", "chat request invoke failed", {
        requestId: this.options.requestId,
        error,
      });
      this.manager.fail(this.options.requestId, error);
      throw error;
    }
    return stream;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
