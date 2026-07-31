import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { streamChat } from "../sidecar/src/runtime";
import type { ChatCommand, RuntimeConnection } from "../sidecar/src/protocol";

const baseCommand = (connection: RuntimeConnection): ChatCommand => ({
  type: "chat",
  requestId: `req-${connection.provider}`,
  conversationId: "conv",
  connection,
  messages: [{
    id: "user",
    role: "user",
    parts: [{ type: "text", text: "hello" }],
  }],
});

const sse = (events: string[]) => new Response(`${events.join("\n\n")}\n\n`, {
  status: 200,
  headers: { "content-type": "text/event-stream" },
});

async function chunksFor(connection: RuntimeConnection, response: Response) {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return response;
  }) as typeof fetch;
  const stream = await streamChat(
    baseCommand(connection),
    new AbortController().signal,
    { fetch: providerFetch },
  );
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  return { chunks, requests };
}

describe("AI SDK direct provider streams", () => {
  it.each([
    ["openai-compatible", "https://custom.example/v1"],
    ["ollama", "http://127.0.0.1:11434"],
  ] as const)("streams %s text through the AI SDK", async (provider, baseUrl) => {
    const { chunks, requests } = await chunksFor({
      id: provider,
      provider,
      modelId: "model",
      baseUrl,
      secret: provider === "ollama" ? undefined : "key",
    }, sse([
      'data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
      'data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}',
      "data: [DONE]",
    ]));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "text-delta",
      delta: "hello",
    }));
    expect(requests[0].input).toMatch(/\/chat\/completions$/);
    if (provider === "ollama") expect(requests[0].input).toContain(":11434/v1/");
  });

  it("streams Anthropic reasoning and text", async () => {
    const { chunks } = await chunksFor({
      id: "anthropic",
      provider: "anthropic",
      modelId: "claude-test",
      secret: "key",
    }, sse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"consider"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"","citations":[]}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ]));

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reasoning-delta", delta: "consider" }),
      expect.objectContaining({ type: "text-delta", delta: "answer" }),
    ]));
  });

  it("streams Gemini text", async () => {
    const { chunks, requests } = await chunksFor({
      id: "gemini",
      provider: "gemini",
      modelId: "gemini-test",
      secret: "key",
    }, sse([
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"gemini"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}',
    ]));

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "text-delta",
      delta: "gemini",
    }));
    expect(requests[0].input).toContain(":streamGenerateContent");
  });
});
