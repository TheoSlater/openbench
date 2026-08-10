import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  devLog: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/features/debug-overlay/devLog", () => ({
  devLog: mocks.devLog,
  summarizeDevValue: (value: unknown) => value,
}));

import { invoke, listen } from "@/lib/tauriBridge";

describe("tauriBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({ ok: true });
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it("logs invoke start and success without changing the result", async () => {
    await expect(invoke("memory_list", { requestId: "request-123456789" })).resolves.toEqual({ ok: true });

    expect(mocks.invoke).toHaveBeenCalledWith("memory_list", { requestId: "request-123456789" });
    expect(mocks.devLog).toHaveBeenCalledWith("debug", "tauri", "memory_list start", expect.objectContaining({
      requestId: "request-12345678",
    }));
    expect(mocks.devLog).toHaveBeenCalledWith("debug", "tauri", "memory_list ok", expect.objectContaining({
      requestId: "request-12345678",
    }));
  });

  it("logs failures and rethrows them", async () => {
    const error = new Error("failed");
    mocks.invoke.mockRejectedValueOnce(error);

    await expect(invoke("memory_list")).rejects.toBe(error);
    expect(mocks.devLog).toHaveBeenCalledWith("error", "tauri", "memory_list error", expect.objectContaining({ error }));
  });

  it("logs event lifecycle and forwards the original payload", async () => {
    let callback: ((event: { event: string; id: number; payload: { ok: boolean } }) => void) | undefined;
    mocks.listen.mockImplementationOnce((_name, handler) => {
      callback = handler;
      return Promise.resolve(() => undefined);
    });
    const handler = vi.fn();

    const stop = await listen("test-event", handler);
    callback?.({ event: "test-event", id: 1, payload: { ok: true } });
    stop();

    expect(handler).toHaveBeenCalledWith({ event: "test-event", id: 1, payload: { ok: true } });
    expect(mocks.devLog).toHaveBeenCalledWith("debug", "event", "test-event subscribe");
    expect(mocks.devLog).toHaveBeenCalledWith("debug", "event", "test-event ready");
    expect(mocks.devLog).toHaveBeenCalledWith("debug", "event", "test-event unsubscribe", { count: 1 });
  });
});
