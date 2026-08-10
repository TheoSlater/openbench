import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { devLog, stopDevLogging } from "@/features/debug-overlay/devLog";

describe("devLog", () => {
  const mockedInvoke = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      value: { __TAURI_INTERNALS__: {} },
      configurable: true,
    });
  });

  it("logs in development even when the debug overlay is off", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    devLog("info", "overlay", "hello");
    devLog("error", "overlay", "boom");

    expect(info).toHaveBeenCalledWith("[dev:overlay] hello");
    expect(error).toHaveBeenCalledWith("[dev:overlay] boom");
    expect(mockedInvoke).toHaveBeenCalledTimes(2);

    info.mockRestore();
    error.mockRestore();
  });

  it("logs to the console and the terminal when dev mode is on", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    devLog("info", "overlay", "enabled");

    expect(info).toHaveBeenCalledWith("[dev:overlay] enabled");
    expect(mockedInvoke).toHaveBeenCalledWith("debug_log", {
      level: "info",
      message: "[dev:overlay] enabled",
    });

    info.mockRestore();
  });

  it("uses the console method matching the level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    devLog("warn", "overlay", "slow");

    expect(warn).toHaveBeenCalledWith("[dev:overlay] slow");
    expect(mockedInvoke).toHaveBeenCalledWith("debug_log", {
      level: "warn",
      message: "[dev:overlay] slow",
    });

    warn.mockRestore();
  });

  it("appends serialized data to the terminal message", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    devLog("info", "overlay", "stats", { fps: 60 });

    expect(info).toHaveBeenCalledWith("[dev:overlay] stats", { fps: 60 });
    expect(mockedInvoke).toHaveBeenCalledWith("debug_log", {
      level: "info",
      message: '[dev:overlay] stats {"fps":60}',
    });

    info.mockRestore();
  });

  it("swallows terminal forwarding failures", () => {
    mockedInvoke.mockRejectedValueOnce(new Error("command unavailable"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(() => devLog("info", "overlay", "persist")).not.toThrow();

    info.mockRestore();
  });

  it("redacts secret and content-bearing data", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    devLog("info", "security", "request", {
      token: "secret-token",
      prompt: "private prompt",
      count: 2,
    });

    expect(info).toHaveBeenCalledWith("[dev:security] request", {
      token: "[REDACTED]",
      prompt: { type: "string", length: 14 },
      count: 2,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("debug_log", {
      level: "info",
      message: expect.stringContaining("[REDACTED]"),
    });

    info.mockRestore();
  });

  it("stops browser and terminal logging after shutdown begins", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    stopDevLogging();
    devLog("info", "shutdown", "should not be emitted");

    expect(info).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
