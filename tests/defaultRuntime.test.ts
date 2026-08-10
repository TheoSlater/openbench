import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import {
  DEFAULT_RUNTIME_KEY,
  isDefaultRuntime,
  readDefaultRuntime,
  writeDefaultRuntime,
} from "@/lib/runtime/default-runtime";

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const CHAT: RuntimeRef = {
  kind: "chat-model",
  connection_id: "conn-1",
  model_id: "claude-opus-5",
};

describe("default runtime", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("persists and recognizes the selected runtime", () => {
    writeDefaultRuntime(CHAT, storage);
    expect(readDefaultRuntime(storage)).toEqual(CHAT);
    expect(isDefaultRuntime(CHAT, storage)).toBe(true);
    expect(isDefaultRuntime(
      { kind: "chat-model", connection_id: "conn-1", model_id: "other" },
      storage,
    )).toBe(false);
  });

  it("treats corrupt storage as absent", () => {
    storage.data.set(DEFAULT_RUNTIME_KEY, "{not json");
    expect(readDefaultRuntime(storage)).toBeNull();
  });
});
