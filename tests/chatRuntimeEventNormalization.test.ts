import { describe, expect, it } from "vitest";
import { normalizeChatRuntimeEvent } from "@/lib/chat/stream-client";

const state = () => ({
  reasoning: new Map<string, string>(),
  webSearchQueries: new Map<string, string>(),
});

describe("normalized chat event delivery", () => {
  it("accumulates reasoning and ends once", () => {
    const current = state();
    normalizeChatRuntimeEvent(
      { type: "reasoning.delta", request_id: "r", delta: "one" },
      current,
    );
    const reasoning = normalizeChatRuntimeEvent(
      { type: "reasoning.delta", request_id: "r", delta: " two" },
      current,
    );
    const completed = normalizeChatRuntimeEvent(
      { type: "completed", request_id: "r", metadata: null },
      current,
    );
    expect(reasoning[0]).toMatchObject({
      kind: "thinking",
      payload: { thinking: "one two" },
    });
    expect(completed[0]).toMatchObject({
      kind: "chunk",
      payload: { done: true },
    });
  });

  it("maps web search without exposing unrelated tools", () => {
    const current = state();
    expect(normalizeChatRuntimeEvent({
      type: "tool.started",
      request_id: "r",
      tool_call_id: "other",
      name: "terminal",
      input: {},
    }, current)).toEqual([]);
    normalizeChatRuntimeEvent({
      type: "tool.started",
      request_id: "r",
      tool_call_id: "search",
      name: "web_search",
      input: { query: "ACP" },
    }, current);
    expect(normalizeChatRuntimeEvent({
      type: "tool.completed",
      request_id: "r",
      tool_call_id: "search",
      output: [],
      error: null,
    }, current)[0]).toMatchObject({
      payload: { query: "ACP", status: "complete" },
    });
  });
});
