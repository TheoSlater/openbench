import { describe, expect, it } from "vitest";
import { listModels } from "../sidecar/src/providers";

describe("AI SDK model discovery", () => {
  it("uses native Anthropic authentication", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const models = await listModels({
      id: "anthropic",
      provider: "anthropic",
      secret: "private-key",
    }, (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({ data: [{ id: "claude-test", display_name: "Claude Test" }] });
    }) as typeof fetch);

    expect(models[0]).toEqual({ id: "claude-test", name: "Claude Test" });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
    expect(calls[0]?.headers.get("x-api-key")).toBe("private-key");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("uses the Gateway catalog without exposing its key", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const models = await listModels({
      id: "gateway",
      provider: "vercel-gateway",
      secret: "gateway-key",
    }, (async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({ models: [{
        id: "anthropic/claude-test",
        name: "Claude Test",
        specification: {
          specificationVersion: "v4",
          provider: "anthropic",
          modelId: "claude-test",
        },
      }] });
    }) as typeof fetch);

    expect(models).toEqual([{ id: "anthropic/claude-test", name: "Claude Test" }]);
    expect(calls[0]?.url).toBe("https://ai-gateway.vercel.sh/v4/ai/config");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer gateway-key");
    expect(JSON.stringify(models)).not.toContain("gateway-key");
  });
});
