import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { streamChat } from "../sidecar/src/runtime";
import type { ChatCommand } from "../sidecar/src/protocol";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  usage,
  finishReason: { unified: reason, raw: reason },
});

const stream = (chunks: unknown[]) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
});

async function run(response: Response) {
  const providerFetch = vi.fn(async () => response) as unknown as typeof fetch;
  const model = new MockLanguageModelV4({
    doStream: [
      {
        stream: stream([
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "call-1", toolName: "web_search" },
          { type: "tool-input-delta", id: "call-1", delta: '{"query":"poly' },
          { type: "tool-input-delta", id: "call-1", delta: ' ui"}' },
          { type: "tool-input-end", id: "call-1" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: '{"query":"poly ui"}',
          },
          finish("tool-calls"),
        ]),
      },
      {
        stream: stream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "grounded answer" },
          { type: "text-end", id: "text-1" },
          finish("stop"),
        ]),
      },
    ],
  });
  const command: ChatCommand = {
    type: "chat",
    requestId: "req-tools",
    conversationId: "conv",
    connection: {
      id: "conn",
      provider: "openai",
      modelId: "model",
      secret: "provider-key",
    },
    messages: [{
      id: "user",
      role: "user",
      parts: [{ type: "text", text: "search" }],
    }],
    webSearch: { provider: "exa", secret: "search-key" },
  };
  const result = await streamChat(command, new AbortController().signal, {
    model,
    fetch: providerFetch,
  });
  const chunks: UIMessageChunk[] = [];
  const reader = result.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return { chunks, model, providerFetch };
}

describe("AI SDK tool loop", () => {
  it("assembles tool deltas, executes web search, cites, and continues", async () => {
    const { chunks, model, providerFetch } = await run(new Response(JSON.stringify({
      results: [{
        title: "PolyUI",
        url: "https://example.com/polyui",
        highlights: ["A local-first chat client"],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    expect(model.doStreamCalls).toHaveLength(2);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool-input-available",
        toolCallId: "call-1",
        input: { query: "poly ui" },
      }),
      expect.objectContaining({
        type: "tool-output-available",
        toolCallId: "call-1",
      }),
      expect.objectContaining({
        type: "source-url",
        url: "https://example.com/polyui",
      }),
      expect.objectContaining({
        type: "text-delta",
        delta: "grounded answer",
      }),
    ]));
  });

  it("surfaces web-search tool errors without crashing the stream", async () => {
    const { chunks, model } = await run(new Response("rate limited", { status: 429 }));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-error",
      toolCallId: "call-1",
      errorText: expect.stringContaining("429"),
    }));
  });
});
