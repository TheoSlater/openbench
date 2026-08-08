import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { ApprovalBroker } from "../sidecar/src/approvals";
import { closeAgentProviders, streamAgent } from "../sidecar/src/agents";
import type { AgentCommand } from "../sidecar/src/protocol";

const fakeCli = fileURLToPath(new URL("./fixtures/fake-agent-cli.mjs", import.meta.url));

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
    workspace: process.cwd(),
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

const textFrom = (chunks: UIMessageChunk[]) => chunks
  .filter((chunk): chunk is Extract<UIMessageChunk, { type: "text-delta" }> => chunk.type === "text-delta")
  .map((chunk) => chunk.delta)
  .join("");

afterEach(closeAgentProviders);

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

  it("maps Codex plan, terminal, and file notifications to typed data parts", async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const item of [
              { type: "plan", id: "plan-1", text: "Inspect files" },
              { type: "commandExecution", id: "cmd-1", command: "bun test", cwd: "/tmp/project", status: "running" },
              { type: "fileChange", id: "file-1", changes: [{ path: "src/app.ts" }], status: "completed" },
            ]) {
              controller.enqueue({
                type: "raw",
                rawValue: { method: "item/completed", params: { item } },
              });
            }
            controller.enqueue({
              type: "finish",
              usage,
              finishReason: { unified: "stop", raw: "stop" },
            });
            controller.close();
          },
        }),
      },
    });
    const chunks = await collect(await streamAgent(
      { ...command, agent: { ...command.agent, kind: "codex" } },
      new AbortController().signal,
      { createModel: async () => ({ model, includeRawChunks: true }) },
    ));

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "data-agent", data: expect.objectContaining({ kind: "plan", id: "plan-1" }) }),
      expect.objectContaining({ type: "data-agent", data: expect.objectContaining({ kind: "terminal", id: "cmd-1" }) }),
      expect.objectContaining({ type: "data-agent", data: expect.objectContaining({ kind: "file", id: "file-1", paths: ["src/app.ts"] }) }),
    ]));
  });

  it("runs and resumes Claude Code through a fake CLI process", async () => {
    const first = await collect(await streamAgent({
      ...command,
      agent: { ...command.agent, executablePath: fakeCli, sessionId: undefined },
    }, new AbortController().signal));
    expect(textFrom(first)).toBe("claude ready");
    expect(first).toContainEqual(expect.objectContaining({
      type: "finish",
      messageMetadata: expect.objectContaining({ agentSessionId: "claude-session-new" }),
    }));

    const resumed = await collect(await streamAgent({
      ...command,
      agent: { ...command.agent, executablePath: fakeCli, sessionId: "claude-session-old" },
    }, new AbortController().signal));
    expect(textFrom(resumed)).toBe("resumed:claude-session-old");
  });

  it("runs, resumes, approves, cancels, and closes a fake Codex app-server", async () => {
    const codex = {
      ...command,
      agent: {
        ...command.agent,
        kind: "codex" as const,
        executablePath: fakeCli,
        modelId: "gpt-5.2-codex",
        sessionId: undefined,
      },
    };
    const first = await collect(await streamAgent(codex, new AbortController().signal));
    const finish = first.find((chunk) => chunk.type === "finish");
    const session = finish && "messageMetadata" in finish
      ? (finish.messageMetadata as { agentSessionId?: string })?.agentSessionId
      : undefined;
    expect(textFrom(first)).toBe("codex ready");
    expect(session).toMatch(/^codex-thread-\d+$/);

    const resumed = await collect(await streamAgent({
      ...codex,
      agent: { ...codex.agent, sessionId: session },
    }, new AbortController().signal));
    expect(textFrom(resumed)).toBe("resumed");

    let approve;
    const broker = new ApprovalBroker((event, requestId) => {
      if (event.kind === "permission") approve = () => broker.resolve(requestId, event.approvalId, true);
    });
    const approvalStream = await streamAgent({
      ...codex,
      messages: [{ id: "user-approval", role: "user", parts: [{ type: "text", text: "[approval]" }] }],
    }, new AbortController().signal, { approvals: broker });
    await vi.waitFor(() => expect(approve).toBeTypeOf("function"), { timeout: 1_000 });
    approve();
    expect(textFrom(await collect(approvalStream))).toBe("approved");

    const abort = new AbortController();
    const cancelled = streamAgent({
      ...codex,
      messages: [{ id: "user-cancel", role: "user", parts: [{ type: "text", text: "[cancel]" }] }],
    }, abort.signal);
    abort.abort(new Error("cancelled"));
    await expect(cancelled.then(collect)).rejects.toThrow(/cancel/i);

    const pid = Number(session?.split("-").at(-1));
    await closeAgentProviders();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 2_000 });
  });
});
