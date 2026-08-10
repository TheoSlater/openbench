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
  it("uses Open-Meteo for weather and streams structured output", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "weather-call", toolName: "displayWeather" },
            { type: "tool-input-delta", id: "weather-call", delta: '{"location":"London"}' },
            { type: "tool-input-end", id: "weather-call" },
            {
              type: "tool-call",
              toolCallId: "weather-call",
              toolName: "displayWeather",
              input: '{"location":"London"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Search-backed result." },
            { type: "text-end", id: "text-1" },
            finish("stop"),
          ]),
        },
      ],
    });

    const result = await streamChat({
      type: "chat",
      requestId: "req-generative-ui",
      connection: {
        id: "conn",
        provider: "openai",
        modelId: "model",
      },
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "weather" }] }],
    }, new AbortController().signal, {
      model,
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          results: [{
            name: "London",
            country: "United Kingdom",
            latitude: 51.5,
            longitude: -0.1,
          }],
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          current: {
            time: "2026-08-06T15:00",
            temperature_2m: 22.4,
            wind_speed_10m: 11.9,
          },
        }), { status: 200 })) as unknown as typeof fetch,
    });
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of result) chunks.push(chunk);

    expect(model.doStreamCalls).toHaveLength(2);
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "weather-call",
      output: {
        location: "London, United Kingdom",
        source: "open-meteo",
        temperature: 22.4,
        windSpeed: 11.9,
        observedAt: "2026-08-06T15:00",
      },
    }));
  });

  it("falls back to web search when Open-Meteo fails", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "weather-fallback", toolName: "displayWeather" },
            { type: "tool-input-delta", id: "weather-fallback", delta: '{"location":"London"}' },
            { type: "tool-input-end", id: "weather-fallback" },
            {
              type: "tool-call",
              toolCallId: "weather-fallback",
              toolName: "displayWeather",
              input: '{"location":"London"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "weather-search", toolName: "web_search" },
            { type: "tool-input-delta", id: "weather-search", delta: '{"query":"current weather in London"}' },
            { type: "tool-input-end", id: "weather-search" },
            {
              type: "tool-call",
              toolCallId: "weather-search",
              toolName: "web_search",
              input: '{"query":"current weather in London"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "weather-render", toolName: "displayWeather" },
            {
              type: "tool-input-delta",
              id: "weather-render",
              delta: '{"location":"London","data":{"temperatureC":22.4,"windSpeedMps":11.9,"condition":"Sunny","observedAt":"2026-08-06T15:00","summary":"Sunny and warm","sourceTitle":"London weather","sourceUrl":"https://example.com/weather"}}',
            },
            { type: "tool-input-end", id: "weather-render" },
            {
              type: "tool-call",
              toolCallId: "weather-render",
              toolName: "displayWeather",
              input: '{"location":"London","data":{"temperatureC":22.4,"windSpeedMps":11.9,"condition":"Sunny","observedAt":"2026-08-06T15:00","summary":"Sunny and warm","sourceTitle":"London weather","sourceUrl":"https://example.com/weather"}}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "fallback-text" },
            { type: "text-delta", id: "fallback-text", delta: "Search fallback." },
            { type: "text-end", id: "fallback-text" },
            finish("stop"),
          ]),
        },
      ],
    });
    const providerFetch = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{
          title: "London weather",
          url: "https://example.com/weather",
          highlights: ["Sunny and warm"],
        }],
      }), { status: 200 }));

    const result = await streamChat({
      type: "chat",
      requestId: "req-weather-fallback",
      connection: {
        id: "conn",
        provider: "openai",
        modelId: "model",
      },
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "weather" }] }],
      webSearch: { provider: "exa", secret: "search-key" },
    }, new AbortController().signal, { model, fetch: providerFetch });
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of result) chunks.push(chunk);

    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "weather-fallback",
      output: expect.objectContaining({
        status: "needs-web-search",
      }),
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "weather-search",
      output: {
        query: "current weather in London",
        results: [{
          title: "London weather",
          url: "https://example.com/weather",
          highlights: ["Sunny and warm"],
        }],
      },
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "source-url",
      sourceId: "weather-search:0",
      url: "https://example.com/weather",
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "weather-render",
      output: {
        location: "London",
        source: "web-search",
        temperature: 22.4,
        windSpeed: 11.9,
        condition: "Sunny",
        observedAt: "2026-08-06T15:00",
        summary: "Sunny and warm",
        sourceTitle: "London weather",
        sourceUrl: "https://example.com/weather",
      },
    }));
  });

  it("searches first, then renders structured stock data", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "stock-search", toolName: "web_search" },
            { type: "tool-input-delta", id: "stock-search", delta: '{"query":"AAPL stock price"}' },
            { type: "tool-input-end", id: "stock-search" },
            {
              type: "tool-call",
              toolCallId: "stock-search",
              toolName: "web_search",
              input: '{"query":"AAPL stock price"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "tool-input-start", id: "stock-render", toolName: "getStockPrice" },
            {
              type: "tool-input-delta",
              id: "stock-render",
              delta: '{"symbol":"AAPL","company":"Apple Inc.","price":185.2,"currency":"USD","change":1.25,"changePercent":0.68,"marketStatus":"Open","asOf":"2026-08-06T15:00","summary":"Apple traded higher in the latest session.","sourceTitle":"Apple stock quote","sourceUrl":"https://example.com/aapl"}',
            },
            { type: "tool-input-end", id: "stock-render" },
            {
              type: "tool-call",
              toolCallId: "stock-render",
              toolName: "getStockPrice",
              input: '{"symbol":"AAPL","company":"Apple Inc.","price":185.2,"currency":"USD","change":1.25,"changePercent":0.68,"marketStatus":"Open","asOf":"2026-08-06T15:00","summary":"Apple traded higher in the latest session.","sourceTitle":"Apple stock quote","sourceUrl":"https://example.com/aapl"}',
            },
            finish("tool-calls"),
          ]),
        },
        {
          stream: stream([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "stock-text" },
            { type: "text-delta", id: "stock-text", delta: "Stock result." },
            { type: "text-end", id: "stock-text" },
            finish("stop"),
          ]),
        },
      ],
    });
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        title: "Apple stock quote",
        url: "https://example.com/aapl",
        highlights: ["Apple traded higher in the latest session."],
      }],
    }), { status: 200 }));

    const result = await streamChat({
      type: "chat",
      requestId: "req-stock-search",
      connection: {
        id: "conn",
        provider: "openai",
        modelId: "model",
      },
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "stock" }] }],
      webSearch: { provider: "exa", secret: "search-key" },
    }, new AbortController().signal, { model, fetch: providerFetch });
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of result) chunks.push(chunk);

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "source-url",
      sourceId: "stock-search:0",
      url: "https://example.com/aapl",
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-input-available",
      toolCallId: "stock-render",
      input: expect.objectContaining({
        symbol: "AAPL",
        price: 185.2,
        currency: "USD",
      }),
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool-output-available",
      toolCallId: "stock-render",
      output: {
        symbol: "AAPL",
        source: "web-search",
        company: "Apple Inc.",
        price: 185.2,
        currency: "USD",
        change: 1.25,
        changePercent: 0.68,
        marketStatus: "Open",
        asOf: "2026-08-06T15:00",
        summary: "Apple traded higher in the latest session.",
        sourceTitle: "Apple stock quote",
        sourceUrl: "https://example.com/aapl",
      },
    }));
  });

  it("passes registry tool selection to the provider", async () => {
    const selectedModel = new MockLanguageModelV4({
      doStream: {
        stream: stream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "answer" },
          { type: "text-end", id: "text-1" },
          finish("stop"),
        ]),
      },
    });
    const result = await streamChat({
      type: "chat",
      requestId: "req-selection",
      conversationId: "conv",
      connection: {
        id: "conn",
        provider: "openai",
        modelId: "model",
      },
      messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "answer" }] }],
      webSearch: { provider: "local" },
      terminal: true,
      activeTools: ["web_search"],
      toolOrder: ["terminal", "web_search"],
    }, new AbortController().signal, { model: selectedModel });
    for await (const chunk of result) void chunk;

    expect(selectedModel.doStreamCalls[0]?.tools?.map((tool) => tool.name)).toEqual([
      "web_search",
    ]);
  });

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
