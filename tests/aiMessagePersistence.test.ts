import { describe, expect, it } from "vitest";
import {
  filterPartsForRuntime,
  fromUIMessage,
  toUIMessage,
  type PolyUIMessage,
} from "@/lib/ai/messages";
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

  it("encodes raw UTF-8 text attachments without corrupting provider payloads", () => {
    const ui = toUIMessage({
      ...entity,
      content: "",
      thinking: undefined,
      runtimeParts: undefined,
      attachments: [{
        id: "file-1",
        name: "notes.md",
        type: "text/markdown",
        size: 12,
        content: "café — notes",
        status: "ready",
      }],
    });
    const file = ui.parts.find((part) => part.type === "file");

    expect(file?.type).toBe("file");
    if (file?.type !== "file") return;
    expect(file.url.startsWith("data:text/markdown;base64,")).toBe(true);

    const encoded = file.url.split(",", 2)[1];
    const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("café — notes");
  });

  it("keeps already-materialized attachment data URLs unchanged", () => {
    const dataUrl = "data:text/plain;base64,SGVsbG8=";
    const ui = toUIMessage({
      ...entity,
      content: "",
      thinking: undefined,
      runtimeParts: undefined,
      attachments: [{
        id: "file-2",
        name: "hello.txt",
        type: "text/plain",
        size: 5,
        content: dataUrl,
        status: "ready",
      }],
    });
    const file = ui.parts.find((part) => part.type === "file");

    expect(file?.type === "file" && file.url).toBe(dataUrl);
  });

  it("keeps text, reasoning, and tool parts in response order", () => {
    const parts = [
      { type: "text", text: "Sure! I will run that command for you." },
      { type: "reasoning", text: "Checking the terminal first." },
      {
        type: "dynamic-tool",
        toolName: "terminal",
        toolCallId: "call-ordered",
        state: "output-available",
        input: { command: "pwd" },
        output: { output: "/tmp" },
      },
      { type: "text", text: "The command completed." },
    ] as const;
    const restored = fromUIMessage({
      id: "assistant-ordered",
      role: "assistant",
      parts,
    } as PolyUIMessage, {
      conversationId: "conv-1",
      model: "model",
      provider: "OpenAICompatible",
    });

    expect(restored.runtimeParts).toEqual(parts);
    expect(toUIMessage(restored).parts).toEqual(parts);
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

  it("preserves tool approval parts", () => {
    const approval = {
      type: "dynamic-tool",
      toolName: "terminal",
      toolCallId: "call-approval",
      state: "approval-requested",
      input: { command: "git status --short" },
      approval: { id: "approval-1" },
    } as const;
    const response = {
      ...approval,
      state: "approval-responded",
      approval: { id: "approval-1", approved: false, reason: "Not now" },
    } as const;
    const restored = fromUIMessage({
      id: "assistant-3",
      role: "assistant",
      parts: [approval, response],
    } as PolyUIMessage, {
      conversationId: "conv-1",
      model: "model",
      provider: "OpenAICompatible",
    });

    expect(restored.runtimeParts).toEqual([approval, response]);
  });

  it("keeps generative UI parts for chat-model history", () => {
    const message = {
      id: "assistant-weather",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "displayWeather",
        toolCallId: "weather-call",
        state: "output-available",
        input: { location: "London" },
        output: {
          location: "London",
          query: "weather London",
          results: [{
            title: "London weather",
            url: "https://example.com/weather",
            highlights: ["Sunny"],
          }],
        },
      }],
    } as PolyUIMessage;

    expect(filterPartsForRuntime(message, "chat-model").parts).toEqual(message.parts);
    expect(filterPartsForRuntime(message, "coding-agent").parts).toEqual([]);
  });
});
