import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatRuntimeEvent } from "@/generated/bindings/ChatRuntimeEvent";

export type ChunkPayload = {
  request_id: string;
  content: string;
  done: boolean;
  thinking?: string;
  metadata?: {
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_duration?: number;
    eval_duration?: number;
  };
  error?: string;
};

export type ThinkingPayload = {
  request_id: string;
  thinking: string;
  is_thinking: boolean;
};

export type WebSearchPayload = {
  request_id: string;
  query: string;
  status: "searching" | "complete" | "error";
  results?: { title: string; url: string; highlights: string[] }[];
};

export type StreamHandlers = {
  onChunk: (payload: ChunkPayload) => void;
  onThinking: (payload: ThinkingPayload) => void;
  onWebSearch: (payload: WebSearchPayload) => void;
};

type LegacyUpdate =
  | { kind: "chunk"; payload: ChunkPayload }
  | { kind: "thinking"; payload: ThinkingPayload }
  | { kind: "web-search"; payload: WebSearchPayload };

type NormalizationState = {
  reasoning: Map<string, string>;
  webSearchQueries: Map<string, string>;
};

export function normalizeChatRuntimeEvent(
  event: ChatRuntimeEvent,
  state: NormalizationState,
): LegacyUpdate[] {
  switch (event.type) {
    case "message.delta":
      return [{ kind: "chunk", payload: { request_id: event.request_id, content: event.delta, done: false } }];
    case "reasoning.delta": {
      const thinking = `${state.reasoning.get(event.request_id) ?? ""}${event.delta}`;
      state.reasoning.set(event.request_id, thinking);
      return [{ kind: "thinking", payload: { request_id: event.request_id, thinking, is_thinking: true } }];
    }
    case "tool.started": {
      if (event.name !== "web_search") return [];
      const query =
        typeof event.input === "object" && event.input !== null && "query" in event.input
          ? String(event.input.query)
          : "";
      state.webSearchQueries.set(event.tool_call_id, query);
      return [{ kind: "web-search", payload: { request_id: event.request_id, query, status: "searching" } }];
    }
    case "tool.completed": {
      const query = state.webSearchQueries.get(event.tool_call_id);
      if (query === undefined) return [];
      state.webSearchQueries.delete(event.tool_call_id);
      return [{
        kind: "web-search",
        payload: {
          request_id: event.request_id,
          query,
          status: event.error ? "error" : "complete",
          results: Array.isArray(event.output) ? event.output as WebSearchPayload["results"] : undefined,
        },
      }];
    }
    case "usage.updated":
      return [{
        kind: "chunk",
        payload: {
          request_id: event.request_id,
          content: "",
          done: false,
          metadata: {
            prompt_eval_count: event.usage.input_tokens === null ? undefined : Number(event.usage.input_tokens),
            eval_count: event.usage.output_tokens === null ? undefined : Number(event.usage.output_tokens),
            total_duration: event.usage.total_duration_ms === null
              ? undefined
              : Number(event.usage.total_duration_ms) * 1_000_000,
          },
        },
      }];
    case "completed":
      state.reasoning.delete(event.request_id);
      return [{ kind: "chunk", payload: { request_id: event.request_id, content: "", done: true } }];
    case "failed":
      state.reasoning.delete(event.request_id);
      return [{
        kind: "chunk",
        payload: {
          request_id: event.request_id,
          content: "",
          done: true,
          error: [event.error.message, event.error.action].filter(Boolean).join(" "),
        },
      }];
    default:
      return [];
  }
}

// Typed wrapper around Tauri event bus. Replaces the singleton StreamEventBus
// with an injectable seam — tests can pass a mock EventBus instead.
export interface EventBus {
  subscribe(handlers: StreamHandlers): Promise<void>;
  unsubscribe(): Promise<void>;
}

export class TauriEventBus implements EventBus {
  private unlisteners: (UnlistenFn | Promise<UnlistenFn>)[] = [];
  private handlers: StreamHandlers | null = null;
  private state: NormalizationState = {
    reasoning: new Map(),
    webSearchQueries: new Map(),
  };

  async subscribe(handlers: StreamHandlers) {
    this.handlers = handlers;
    if (this.unlisteners.length > 0) return;
    this.unlisteners = [
      listen<ChatRuntimeEvent>("chat-runtime-event", (event) => {
        for (const update of normalizeChatRuntimeEvent(event.payload, this.state)) {
          if (update.kind === "chunk") this.handlers?.onChunk(update.payload);
          else if (update.kind === "thinking") this.handlers?.onThinking(update.payload);
          else this.handlers?.onWebSearch(update.payload);
        }
      }),
    ];
  }

  async unsubscribe() {
    const toUnsubscribe = [...this.unlisteners];
    this.unlisteners = [];
    this.handlers = null;
    this.state.reasoning.clear();
    this.state.webSearchQueries.clear();
    for (const u of toUnsubscribe) {
      const fn = await u;
      fn();
    }
  }
}
