import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockDevLogStore = vi.hoisted(() => ({ getState: () => ({ devMode: false }) }));
vi.mock("@/store/devStore", () => ({
  useDevStore: mockDevLogStore,
}));

import { devLog } from "@/features/debug-overlay/devLog";

describe("devLog", () => {
  const mockedInvoke = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevLogStore.getState = () => ({ devMode: false });
  });

  it("is a no-op when dev mode is off", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    devLog("info", "overlay", "hello");
    devLog("error", "overlay", "boom");

    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(mockedInvoke).not.toHaveBeenCalled();

    info.mockRestore();
    error.mockRestore();
  });

  it("logs to the console and the terminal when dev mode is on", () => {
    mockDevLogStore.getState = () => ({ devMode: true });
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
    mockDevLogStore.getState = () => ({ devMode: true });
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
    mockDevLogStore.getState = () => ({ devMode: true });
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
    mockDevLogStore.getState = () => ({ devMode: true });
    mockedInvoke.mockRejectedValueOnce(new Error("command unavailable"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(() => devLog("info", "overlay", "persist")).not.toThrow();

    info.mockRestore();
  });
});