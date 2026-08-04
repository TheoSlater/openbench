import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { streamChat } from "../sidecar/src/runtime";
import { RuntimeServer } from "../sidecar/src/server";
import type { ChatCommand, RuntimeRecord } from "../sidecar/src/protocol";
import { ptyBroker } from "../sidecar/src/terminal";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 2, reasoning: 2 },
};

const command = (requestId = "req-1"): ChatCommand => ({
  type: "chat",
  requestId,
  conversationId: "conv-1",
  connection: {
    id: "conn-1",
    provider: "openai",
    modelId: "gpt-test",
    secret: "private-key",
  },
  messages: [{
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "hello" }],
  }],
});

function model(chunks: Parameters<ReadableStream["constructor"]>[0] extends never ? never : unknown[]) {
  return new MockLanguageModelV4({
    doStream: {
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    },
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("AI sidecar runtime", () => {
  it("converts text, reasoning, usage, and finish into AI SDK UI chunks", async () => {
    const chunks = await collect(await streamChat(
      command(),
      new AbortController().signal,
      {
        model: model([
          { type: "stream-start", warnings: [] },
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: "think" },
          { type: "reasoning-end", id: "r1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "answer" },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            usage,
            finishReason: { unified: "stop", raw: "stop" },
          },
        ]),
      },
    ));

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reasoning-delta", delta: "think" }),
      expect.objectContaining({ type: "text-delta", delta: "answer" }),
      expect.objectContaining({
        type: "finish",
        messageMetadata: expect.objectContaining({ finishReason: "stop" }),
      }),
    ]));
  });

  it("keeps parallel request records isolated", async () => {
    const records: RuntimeRecord[] = [];
    const server = new RuntimeServer({
      write: (record) => records.push(record),
      streamChat: async (request) => new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: request.requestId });
          controller.enqueue({
            type: "text-delta",
            id: request.requestId,
            delta: request.requestId,
          });
          controller.enqueue({ type: "text-end", id: request.requestId });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          controller.close();
        },
      }),
    });

    await server.handle(command("req-a"));
    await server.handle(command("req-b"));
    await vi.waitFor(() => expect(server.activeRequestCount).toBe(0));

    const chunks = records.filter((record) => record.type === "chunk");
    expect(chunks.filter((record) => record.requestId === "req-a")).toHaveLength(4);
    expect(chunks.filter((record) => record.requestId === "req-b")).toHaveLength(4);
  });

  it("collects mobile text inside the JavaScript runtime", async () => {
    const records: RuntimeRecord[] = [];
    const server = new RuntimeServer({
      write: (record) => records.push(record),
      streamChat: async () => new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", id: "t", delta: "one" });
          controller.enqueue({ type: "text-delta", id: "t", delta: " two" });
          controller.close();
        },
      }),
    });

    await server.handle({ ...command(), collectText: true });
    await vi.waitFor(() => expect(server.activeRequestCount).toBe(0));

    expect(records).toContainEqual({
      type: "chunk",
      requestId: "req-1",
      chunk: { type: "data-runtime-result", data: { text: "one two" } },
    });
  });

  it("routes PTY relay commands to the terminal broker", async () => {
    const server = new RuntimeServer({ write: () => undefined });
    const run = ptyBroker.awaitRun("server-pty-call", "ls", undefined);
    const data = [...new TextEncoder().encode("a\nb")];

    await server.handle({
      type: "pty-data",
      requestId: "server-pty-call",
      payload: { data },
    });
    await server.handle({
      type: "pty-exit",
      requestId: "server-pty-call",
      payload: { exitCode: 0 },
    });

    await expect(run).resolves.toMatchObject({ output: "a\nb", exitCode: 0 });
  });

  it("routes cancellation to only the selected request", async () => {    const aborted: string[] = [];
    const server = new RuntimeServer({
      write: () => undefined,
      streamChat: async (request, signal) => new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => {
            aborted.push(request.requestId);
            controller.close();
          }, { once: true });
        },
      }),
    });

    await server.handle(command("req-a"));
    await server.handle(command("req-b"));
    await server.handle({ type: "cancel", requestId: "req-a" });
    await vi.waitFor(() => expect(aborted).toEqual(["req-a"]));
    await vi.waitFor(() => expect(server.activeRequestCount).toBe(1));
    await server.handle({ type: "cancel", requestId: "req-b" });
  });
});
