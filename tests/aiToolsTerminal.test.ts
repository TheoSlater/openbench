import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { UIMessageChunk } from "ai";
import { streamChat } from "../sidecar/src/runtime";
import type { ChatCommand } from "../sidecar/src/protocol";
import {
  PtyBroker,
  createTerminalTool,
  withTerminalEvents,
} from "../sidecar/src/terminal";

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

const bytes = (text: string) => new TextEncoder().encode(text);

describe("PtyBroker", () => {
  it("resolves a run with the relayed output and exit code", async () => {
    const broker = new PtyBroker();
    const run = broker.awaitRun("t1", "printf ok", undefined);
    broker.append("t1", bytes("hel"));
    broker.append("t1", bytes("lo\n"));
    broker.finish("t1", 0);

    await expect(run).resolves.toEqual({
      command: "printf ok",
      cwd: undefined,
      exitCode: 0,
      output: "hello\n",
      durationMs: expect.any(Number),
      truncated: false,
    });
  });

  it("keeps each tool call's output separate", async () => {
    const broker = new PtyBroker();
    const first = broker.awaitRun("t1", "cmd a", "/tmp");
    const second = broker.awaitRun("t2", "cmd b", undefined);
    broker.append("t1", bytes("from-a"));
    broker.append("t2", bytes("from-b"));
    broker.finish("t1", 0);
    broker.finish("t2", 2);

    await expect(first).resolves.toMatchObject({ output: "from-a", exitCode: 0, cwd: "/tmp" });
    await expect(second).resolves.toMatchObject({ output: "from-b", exitCode: 2 });
  });

  it("buffers relay data that arrives before the run registers", async () => {
    const broker = new PtyBroker();
    broker.append("late", bytes("early-"));
    expect(broker.pendingCount).toBe(0);

    const run = broker.awaitRun("late", "cmd", undefined);
    broker.append("late", bytes("output"));
    broker.finish("late", 1);

    await expect(run).resolves.toMatchObject({ output: "early-output", exitCode: 1 });
  });

  it("caps the output and marks it truncated", async () => {
    const broker = new PtyBroker();
    const run = broker.awaitRun("t1", "noisy");
    const chunk = bytes("x".repeat(50_000));
    for (let i = 0; i < 5; i++) broker.append("t1", chunk);
    broker.finish("t1", 0);

    const result = await run;
    expect(result.truncated).toBe(true);
    expect(result.output).toHaveLength(100_000);
  });

  it("rejects when the session never attaches in time", async () => {
    const broker = new PtyBroker();
    const run = broker.awaitRun("t1", "hangs", undefined, undefined, 20);
    await expect(run).rejects.toThrow(/did not attach/);
  });

  it("rejects when aborted", async () => {
    const broker = new PtyBroker();
    const controller = new AbortController();
    const run = broker.awaitRun("t1", "runs long", undefined, controller.signal);
    setTimeout(() => controller.abort("cancelled"), 10);
    await expect(run).rejects.toThrow(/cancelled/);
  });
});

describe("createTerminalTool", () => {
  it("awaits the broker using its tool call id", async () => {
    const broker = new PtyBroker();
    const terminalTool = createTerminalTool({ broker });

    const promise = terminalTool.execute(
      { command: "ls", cwd: "/tmp" },
      { toolCallId: "t1", abortSignal: new AbortController().signal },
    );
    broker.append("t1", bytes("a\nb"));
    broker.finish("t1", 0);
    await expect(promise).resolves.toMatchObject({
      command: "ls",
      cwd: "/tmp",
      exitCode: 0,
      output: "a\nb",
    });
  });

  it("rejects a missing command", async () => {
    const terminalTool = createTerminalTool({ broker: new PtyBroker() });
    expect(() => terminalTool.inputSchema.parse({})).toThrow();
  });
});

describe("withTerminalEvents", () => {
  it("annotates terminal tool calls with a start chunk", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: "tool-input-available",
          toolCallId: "t1",
          toolName: "terminal",
          input: { command: "ls", cwd: "/tmp" },
        });
        controller.enqueue({
          type: "tool-output-available",
          toolCallId: "t1",
          toolName: "terminal",
          output: { command: "ls", output: "a\nb", exitCode: 0 },
        });
        controller.close();
      },
    });

    const output = withTerminalEvents(input);
    const chunks: UIMessageChunk[] = [];
    const reader = output.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toEqual([
      expect.objectContaining({ type: "tool-input-available" }),
      {
        type: "data-terminal",
        id: "t1",
        data: { kind: "start", command: "ls", cwd: "/tmp" },
      },
      expect.objectContaining({ type: "tool-output-available" }),
    ]);
  });

  it("leaves other tools alone", async () => {
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({
          type: "tool-input-available",
          toolCallId: "w1",
          toolName: "web_search",
          input: { query: "anything" },
        });
        controller.close();
      },
    });

    const output = withTerminalEvents(input);
    const chunks: UIMessageChunk[] = [];
    const reader = output.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).not.toHaveProperty("type", "data-terminal");
  });
});

describe("terminal tool inside the chat loop", () => {
  it("waits for the PTY relay, reports output, and continues", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "call-1", toolName: "terminal" },
            { type: "tool-input-delta", id: "call-1", delta: '{"command":"printf ok' },
            { type: "tool-input-delta", id: "call-1", delta: '"}' },
            { type: "tool-input-end", id: "call-1" },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "terminal",
              input: '{"command":"printf ok"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "ran it" },
            { type: "text-end", id: "text-1" },
            finish("stop"),
          ]),
        },
      ],
    });
    const command: ChatCommand = {
      type: "chat",
      requestId: "req-term",
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
        parts: [{ type: "text", text: "run a command" }],
      }],
      terminal: true,
    };

    const broker = new PtyBroker();
    const result = await streamChat(command, new AbortController().signal, {
      model,
      terminalBroker: broker,
    });
    const chunks: UIMessageChunk[] = [];
    const reader = result.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      if (
        next.value.type === "data-terminal"
        && next.value.data.kind === "start"
      ) {
        broker.append("call-1", bytes("ok"));
        broker.finish("call-1", 0);
      }
    }

    expect(model.doStreamCalls).toHaveLength(2);
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "data-terminal",
        id: "call-1",
        data: expect.objectContaining({ kind: "start", command: "printf ok" }),
      }),
      expect.objectContaining({
        type: "tool-output-available",
        toolCallId: "call-1",
        output: expect.objectContaining({
          command: "printf ok",
          output: "ok",
          exitCode: 0,
          truncated: false,
        }),
      }),
      expect.objectContaining({ type: "text-delta", delta: "ran it" }),
    ]));
  });
});
