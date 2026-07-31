import { describe, expect, it } from "vitest";
import { fromUIMessage, toUIMessage } from "@/lib/ai/messages";
import type { Message } from "@/types/chat";

const entity: Message = {
  id: "assistant-1",
  conversationId: "conv-1",
  role: "assistant",
  content: "answer",
  thinking: "reasoning",
  createdAt: "2026-07-30T00:00:00.000Z",
  model: "gpt-test",
  provider: "OpenAICompatible",
  status: "complete",
  runtimeParts: [{
    type: "source-url",
    sourceId: "source-1",
    url: "https://example.com",
    title: "Example",
  }],
  usage: {
    inputTokens: 4,
    outputTokens: 7,
    totalTokens: 11,
  },
  finishReason: "stop",
};

describe("AI SDK message persistence boundary", () => {
  it("round-trips structured parts without duplicating text or reasoning", () => {
    const ui = toUIMessage(entity);
    expect(ui.parts).toEqual([
      { type: "reasoning", text: "reasoning" },
      { type: "text", text: "answer" },
      entity.runtimeParts?.[0],
    ]);

    const restored = fromUIMessage(ui, {
      conversationId: entity.conversationId,
      model: entity.model,
      provider: entity.provider,
    });
    expect(restored).toMatchObject(entity);
    expect(restored.runtimeParts).toHaveLength(1);
  });

  it("restores web-search citations from standard tool and source parts", () => {
    const restored = fromUIMessage({
      id: "assistant-2",
      role: "assistant",
      metadata: { createdAt: entity.createdAt },
      parts: [
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "poly ui" },
          output: {
            query: "poly ui",
            results: [{
              title: "PolyUI",
              url: "https://example.com/poly",
              highlights: ["Local first"],
            }],
          },
        },
        {
          type: "source-url",
          sourceId: "call-1:0",
          url: "https://example.com/poly",
          title: "PolyUI",
        },
      ],
    }, {
      conversationId: "conv-1",
      model: "model",
      provider: "OpenAICompatible",
    });

    expect(restored.webSearch).toEqual({
      request_id: "call-1",
      query: "poly ui",
      status: "complete",
      results: [{
        title: "PolyUI",
        url: "https://example.com/poly",
        highlights: ["Local first"],
      }],
    });
  });
});
