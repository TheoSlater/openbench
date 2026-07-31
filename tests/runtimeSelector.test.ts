import { describe, expect, it } from "vitest";
import type { RuntimeOption } from "@/features/runtime/runtime-options";
import {
  filterRuntimeOptions,
  groupRuntimeOptions,
  isExternalOption,
  isLocalOption,
  moveRuntimeHighlight,
  requiresRuntimeFork,
} from "@/features/runtime/runtime-options";

const options: RuntimeOption[] = [
  {
    id: "agent:codex",
    family: "coding-agent",
    group: "Coding agents",
    title: "Codex",
    connection: "Local CLI",
    available: false,
    runtime: null,
  },
  {
    id: "model:a:gpt",
    family: "chat-model",
    group: "Cloud models",
    title: "GPT",
    connection: "Work OpenAI",
    available: true,
    runtime: { kind: "chat-model", connection_id: "a", model_id: "gpt" },
  },
  {
    id: "model:b:qwen",
    family: "chat-model",
    group: "Local models",
    title: "Qwen",
    connection: "Laptop Ollama",
    available: true,
    runtime: { kind: "chat-model", connection_id: "b", model_id: "qwen" },
  },
];

describe("runtime selector options", () => {
  it("searches title and connection metadata", () => {
    expect(filterRuntimeOptions(options, "work").map((item) => item.id)).toEqual([
      "model:a:gpt",
    ]);
  });

  it("keeps coding agents before recent, cloud, and local models", () => {
    const recent = new Set(["model:b:qwen"]);
    expect(groupRuntimeOptions(options, recent).map(([name]) => name)).toEqual([
      "Coding agents",
      "Recent models",
      "Cloud models",
    ]);
  });

  it("keeps unavailable agents searchable for direct setup", () => {
    expect(filterRuntimeOptions(options, "codex")[0]).toMatchObject({
      available: false,
      runtime: null,
    });
  });

  it("treats only cloud chat models as external, not agents or local models", () => {
    expect(options.map(isExternalOption)).toEqual([false, true, false]);
  });

  it("treats only Ollama/LM Studio chat models as local, not agents or cloud models", () => {
    expect(options.map(isLocalOption)).toEqual([false, false, true]);
  });

  it("wraps keyboard navigation and detects family switches", () => {
    expect(moveRuntimeHighlight(0, -1, options.length)).toBe(2);
    expect(moveRuntimeHighlight(2, 1, options.length)).toBe(0);
    expect(requiresRuntimeFork(options[1].runtime, options[0])).toBe(true);
    expect(requiresRuntimeFork(options[1].runtime, options[2])).toBe(false);
  });
});
