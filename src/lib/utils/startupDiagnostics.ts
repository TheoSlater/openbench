import { invoke, listen } from "@/lib/tauriBridge";
import { devLog, isDevLoggingEnabled, stopDevLogging } from "@/features/debug-overlay/devLog";

const MAX_LOG_MESSAGE_LENGTH = 1200;

function safeMessage(value: unknown): string {
  const message =
    value instanceof Error
      ? `${value.name}: ${value.message}\n${value.stack ?? ""}`
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (message || "unknown").slice(0, MAX_LOG_MESSAGE_LENGTH);
}

export function startupPhase(message: string): void {
  devLog("info", "startup", message);
  void invoke("log_startup_phase", { message }).catch(() => undefined);
}

export function startupError(message: string, error?: unknown): void {
  const detail = error === undefined ? message : `${message}: ${safeMessage(error)}`;
  devLog("error", "startup", "Startup error", {
    messageLength: message.length,
    hasError: error !== undefined,
    error,
  });
  void invoke("log_startup_error", { message: detail }).catch(() => undefined);
}

export function installFrontendDiagnostics(): void {
  if (!import.meta.env.DEV) return;
  startupPhase("diagnostics installed");
  void listen<{ level?: string; message?: string }>("dev-log", ({ payload }) => {
    if (!isDevLoggingEnabled()) return;
    const level = payload.level === "error"
      ? "error"
      : payload.level === "warn"
        ? "warn"
        : payload.level === "debug"
          ? "debug"
          : "info";
    console[ level === "debug" ? "log" : level ](payload.message ?? "[dev] empty remote log");
  }).catch(() => undefined);
  window.addEventListener("beforeunload", stopDevLogging, { once: true });
  window.addEventListener("error", (event) => {
    startupError(event.message, event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    startupError("unhandled rejection", event.reason);
  });
}

export function backupCorruptStorageItem(key: string, raw: string, error: unknown): void {
  const backupKey = `${key}.corrupt-${Date.now()}`;
  try {
    localStorage.setItem(backupKey, raw);
  } catch {
    // Storage may be unavailable or quota-limited. Original key is still removed below.
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing else to recover.
  }
  startupError(`recovered corrupt localStorage item ${key}; backup=${backupKey}`, error);
}
