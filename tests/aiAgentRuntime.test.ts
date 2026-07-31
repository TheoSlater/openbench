import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { ApprovalBroker } from "../sidecar/src/approvals";
import { streamAgent } from "../sidecar/src/agents";
import type { AgentCommand } from "../sidecar/src/protocol";

const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 2, reasoning: 1 },
};

const command: AgentCommand = {
  type: "agent",
  requestId: "req-agent",
  responseMessageId: "assistant-1",
  conversationId: "conv-1",
  agent: {
    kind: "claude-code",
    workspace: "/tmp/project",
    accessMode: "workspace-write",
    sessionId: "session-old",
  },
  messages: [{
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "inspect the project" }],
  }],
};

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("coding agent runtime", () => {
  it("streams through AI SDK UI parts and persists the provider session id", async () => {
    const close = vi.fn(async () => undefined);
    const model = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "reasoning-start", id: "reasoning" });
            controller.enqueue({ type: "reasoning-delta", id: "reasoning", delta: "checking" });
            controller.enqueue({ type: "reasoning-end", id: "reasoning" });
            controller.enqueue({ type: "text-start", id: "text" });
            controller.enqueue({ type: "text-delta", id: "text", delta: "done" });
            controller.enqueue({ type: "text-end", id: "text" });
            controller.enqueue({
              type: "finish",
              usage,
              finishReason: { unified: "stop", raw: "stop" },
              providerMetadata: { "claude-code": { sessionId: "session-new" } },
            });
            controller.close();
          },
        }),
      },
    });
    const chunks = await collect(await streamAgent(
      command,
      new AbortController().signal,
      { createModel: async () => ({ model, close }) },
    ));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "finish",
      messageMetadata: expect.objectContaining({ agentSessionId: "session-new" }),
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("waits for explicit approval and aborts pending requests", async () => {
    const events: unknown[] = [];
    const broker = new ApprovalBroker((event) => events.push(event));
    const allowed = broker.request("req", "approval", { action: "Run command" });
    expect(events).toContainEqual(expect.objectContaining({
      kind: "permission",
      approvalId: "approval",
      status: "pending",
    }));
    expect(broker.resolve("req", "approval", true)).toBe(true);
    await expect(allowed).resolves.toEqual({ approved: true, reason: undefined });

    const controller = new AbortController();
    const cancelled = broker.request("req", "second", { action: "Edit file" }, controller.signal);
    controller.abort();
    await expect(cancelled).resolves.toEqual({ approved: false, reason: "cancelled" });
  });
});
