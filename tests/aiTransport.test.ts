import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  RuntimeTransportManager,
  TauriChatTransport,
  type RuntimeBridge,
  type RuntimeEvent,
} from "@/lib/ai/transport";

class FakeBridge implements RuntimeBridge {
  listener?: (event: RuntimeEvent) => void;
  listens = 0;
  calls: Array<{ command: string; args?: Record<string, unknown> }> = [];

  async listen(listener: (event: RuntimeEvent) => void) {
    this.listens += 1;
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  async invoke(command: string, args?: Record<string, unknown>) {
    this.calls.push({ command, args });
  }

  emit(event: RuntimeEvent) {
    this.listener?.(event);
  }
}

const messages: UIMessage[] = [{
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
}];

async function readOne(stream: ReadableStream) {
  return stream.getReader().read();
}

describe("Tauri AI SDK transport", () => {
  it("installs one listener and isolates parallel requests", async () => {
    const bridge = new FakeBridge();
    const manager = new RuntimeTransportManager(bridge);
    const a = new TauriChatTransport({
      manager,
      requestId: "req-a",
      conversationId: "conv",
      connectionId: "conn",
      modelId: "model-a",
    });
    const b = new TauriChatTransport({
      manager,
      requestId: "req-b",
      conversationId: "conv",
      connectionId: "conn",
      modelId: "model-b",
    });
    const streamA = await a.sendMessages({
      trigger: "submit-message",
      chatId: "chat-a",
      messageId: undefined,
      messages,
    });
    const streamB = await b.sendMessages({
      trigger: "submit-message",
      chatId: "chat-b",
      messageId: undefined,
      messages,
    });
    expect(bridge.listens).toBe(1);

    bridge.emit({
      type: "chunk",
      request_id: "req-b",
      chunk: { type: "text-delta", id: "tb", delta: "b" },
    });
    bridge.emit({
      type: "chunk",
      request_id: "req-a",
      chunk: { type: "text-delta", id: "ta", delta: "a" },
    });
    await expect(readOne(streamA)).resolves.toMatchObject({ value: { delta: "a" } });
    await expect(readOne(streamB)).resolves.toMatchObject({ value: { delta: "b" } });
  });

  it("cancels only its request when the AI SDK abort signal fires", async () => {
    const bridge = new FakeBridge();
    const controller = new AbortController();
    const transport = new TauriChatTransport({
      manager: new RuntimeTransportManager(bridge),
      requestId: "req-cancel",
      conversationId: "conv",
      connectionId: "conn",
      modelId: "model",
    });
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat",
      messageId: undefined,
      messages,
      abortSignal: controller.signal,
    });
    controller.abort();
    await vi.waitFor(() => expect(bridge.calls).toContainEqual({
      command: "ai_runtime_cancel",
      args: { requestId: "req-cancel" },
    }));
  });

  it("serializes connection ids but no provider credentials", async () => {
    const bridge = new FakeBridge();
    const transport = new TauriChatTransport({
      manager: new RuntimeTransportManager(bridge),
      requestId: "req-safe",
      conversationId: "conv",
      connectionId: "conn",
      modelId: "model",
      token: () => "session-token",
    });
    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat",
      messageId: undefined,
      messages,
    });
    const encoded = JSON.stringify(bridge.calls[0]);
    expect(encoded).toContain("connectionId");
    expect(encoded).not.toMatch(/apiKey|api_key|credential|authorization/i);
  });
});
