import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../sidecar/src/tools";

describe("AI tool registry", () => {
  it("adds generative UI tools when enabled", () => {
    const registry = createToolRegistry({
      generativeUI: true,
      webSearch: { provider: "local" },
    });

    expect(Object.keys(registry.tools)).toEqual([
      "web_search",
      "displayWeather",
      "getStockPrice",
    ]);
    expect(registry.toolOrder).toEqual([
      "web_search",
      "displayWeather",
      "getStockPrice",
    ]);
  });

  it("builds stable enabled tools and approval policy", () => {
    const registry = createToolRegistry({
      webSearch: { provider: "local" },
      terminal: true,
    });

    expect(Object.keys(registry.tools)).toEqual(["web_search", "terminal"]);
    expect(registry.toolOrder).toEqual(["web_search", "terminal"]);
    expect(registry.toolApproval).toEqual({ terminal: "user-approval" });
  });

  it("filters active tools and rejects unknown forced tools", () => {
    expect(createToolRegistry({
      terminal: true,
      activeTools: ["terminal", "missing"],
      toolOrder: ["missing", "terminal"],
    })).toMatchObject({
      activeTools: ["terminal"],
      toolOrder: ["terminal"],
    });
    expect(createToolRegistry({
      webSearch: { provider: "local" },
      terminal: true,
      toolOrder: ["terminal"],
    }).toolOrder).toEqual(["terminal", "web_search"]);

    expect(() => createToolRegistry({
      terminal: true,
      toolChoice: { type: "tool", toolName: "missing" },
    })).toThrow("Unknown tool");
  });
});
