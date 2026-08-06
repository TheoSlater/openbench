import { invoke } from "@tauri-apps/api/core";
import { useDevStore } from "@/store/devStore";
import type { DevLogLevel } from "./types";

const CONSOLE_FN: Record<DevLogLevel, "log" | "log" | "info" | "warn" | "error"> = {
  debug: "log",
  info: "info",
  warn: "warn",
  error: "error",
};

/**
 * Dev-only logging: writes to the browser console and forwards to the Rust
 * terminal. No-ops outside dev mode. Never throws.
 */
export function devLog(
  level: DevLogLevel,
  source: string,
  message: string,
  data?: unknown,
): void {
  if (!useDevStore.getState().devMode) return;
  const line = `[dev:${source}] ${message}`;
  const logFn = console[CONSOLE_FN[level]];
  if (data === undefined) {
    logFn(line);
  } else {
    logFn(line, data);
  }
  const terminalMessage = data === undefined ? line : `${line} ${JSON.stringify(data)}`;
  void invoke("debug_log", { level, message: terminalMessage }).catch(() => undefined);
}