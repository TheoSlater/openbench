import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import {
  DEFAULT_RUNTIME_KEY,
  LEGACY_DEFAULT_MODEL_KEY,
  migrateLegacyDefaultModel,
  readDefaultRuntime,
} from "@/lib/runtime/legacy-default-model";

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const CHAT: RuntimeRef = {
  kind: "chat-model",
  connection_id: "conn-1",
  model_id: "claude-opus-5",
};

describe("legacy default model migration", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("stores the resolved runtime reference", async () => {
    storage.data.set(LEGACY_DEFAULT_MODEL_KEY, "AnthropicNative:claude-opus-5");
    const resolve = vi.fn().mockResolvedValue(CHAT);

    const result = await migrateLegacyDefaultModel(resolve, storage);

    expect(resolve).toHaveBeenCalledWith("AnthropicNative:claude-opus-5");
    expect(result).toEqual(CHAT);
    expect(readDefaultRuntime(storage)).toEqual(CHAT);
  });

  it("clears the legacy key once resolved, since nothing reads it after checkpoint 7", async () => {
    storage.data.set(LEGACY_DEFAULT_MODEL_KEY, "OllamaLocal:llama3.2%3A3b");
    await migrateLegacyDefaultModel(vi.fn().mockResolvedValue(CHAT), storage);

    expect(storage.getItem(LEGACY_DEFAULT_MODEL_KEY)).toBeNull();
  });

  it("runs once, not on every launch", async () => {
    storage.data.set(LEGACY_DEFAULT_MODEL_KEY, "OllamaLocal:llama3");
    const resolve = vi.fn().mockResolvedValue(CHAT);

    await migrateLegacyDefaultModel(resolve, storage);
    await migrateLegacyDefaultModel(resolve, storage);
    await migrateLegacyDefaultModel(resolve, storage);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("stops retrying a default that no longer resolves", async () => {
    storage.data.set(LEGACY_DEFAULT_MODEL_KEY, "GeminiNative:gone");
    const resolve = vi.fn().mockResolvedValue(null);

    expect(await migrateLegacyDefaultModel(resolve, storage)).toBeNull();
    expect(readDefaultRuntime(storage)).toBeNull();

    // The pre-rework behavior retried an unresolvable default forever.
    await migrateLegacyDefaultModel(resolve, storage);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("retries after a lookup failure rather than losing the default", async () => {
    storage.data.set(LEGACY_DEFAULT_MODEL_KEY, "OllamaLocal:llama3");
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend not ready"))
      .mockResolvedValueOnce(CHAT);

    expect(await migrateLegacyDefaultModel(resolve, storage)).toBeNull();
    expect(await migrateLegacyDefaultModel(resolve, storage)).toEqual(CHAT);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there is no legacy default", async () => {
    const resolve = vi.fn();
    expect(await migrateLegacyDefaultModel(resolve, storage)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("treats a corrupt stored runtime as absent", () => {
    storage.data.set(DEFAULT_RUNTIME_KEY, "{not json");
    expect(readDefaultRuntime(storage)).toBeNull();
  });
});
