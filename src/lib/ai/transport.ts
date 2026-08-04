import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

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
    return tauriListen<RuntimeEvent>("ai-runtime-event", ({ payload }) => listener(payload));
  },
  invoke: (command, args) => tauriInvoke(command, args),
};

export class RuntimeTransportManager {
  private readonly streams = new Map<string, ReadableStreamDefaultController<UIMessageChunk>>();
  private listener: Promise<void> | undefined;

  constructor(private readonly bridge: RuntimeBridge) {}

  async ready(): Promise<void> {
    this.listener ??= this.bridge.listen((event) => this.route(event)).then(() => undefined);
    await this.listener;
  }

  open(requestId: string): ReadableStream<UIMessageChunk> {
    if (this.streams.has(requestId)) throw new Error(`Duplicate AI request: ${requestId}`);
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        this.streams.set(requestId, controller);
      },
      cancel: () => this.cancel(requestId),
    });
  }

  async invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.bridge.invoke(command, args);
  }

  fail(requestId: string, error: unknown): void {
    const controller = this.streams.get(requestId);
    if (!controller) return;
    this.streams.delete(requestId);
    controller.error(error instanceof Error ? error : new Error(String(error)));
  }

  private route(event: RuntimeEvent): void {
    const controller = this.streams.get(event.request_id);
    if (!controller) return;
    if (event.type === "chunk") {
      controller.enqueue(event.chunk);
      return;
    }
    this.streams.delete(event.request_id);
    if (event.type === "error") controller.error(new Error(event.error));
    else controller.close();
  }

  private async cancel(requestId: string): Promise<void> {
    this.streams.delete(requestId);
    await this.bridge.invoke("ai_runtime_cancel", { requestId });
  }
}

export const aiRuntimeManager = new RuntimeTransportManager(tauriBridge);

export type AgentTransport = {
  kind: "claude-code" | "codex";
  workspaceId: string;
  accessMode: "read-only" | "workspace-write";
  sessionId?: string;
};

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
    const stream = this.manager.open(this.options.requestId);
    await this.manager.ready();
    const abort = () => {
      void this.manager.invoke("ai_runtime_cancel", { requestId: this.options.requestId });
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
        },
        token: this.options.token?.() ?? null,
      });
    } catch (error) {
      this.manager.fail(this.options.requestId, error);
      throw error;
    }
    return stream;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
