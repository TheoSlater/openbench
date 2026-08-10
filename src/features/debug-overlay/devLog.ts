import { invoke } from "@tauri-apps/api/core";
import type { DevLogLevel } from "./types";

const CONSOLE_FN: Record<DevLogLevel, "log" | "log" | "info" | "warn" | "error"> = {
  debug: "log",
  info: "info",
  warn: "warn",
  error: "error",
};

const MAX_LOG_MESSAGE_LENGTH = 1200;
const MAX_LOG_DEPTH = 4;
const REDACTED = "[REDACTED]";
let loggingEnabled = true;
const SECRET_KEYS = new Set([
  "api_key",
  "apikey",
  "authorization",
  "credential",
  "password",
  "secret",
  "token",
  "x_api_key",
]);
const CONTENT_KEYS = new Set([
  "audio",
  "audiosamples",
  "body",
  "command",
  "content",
  "data",
  "description",
  "headers",
  "instructions",
  "email",
  "fullname",
  "name",
  "message",
  "messages",
  "output",
  "payload",
  "path",
  "prompt",
  "query",
  "text",
  "url",
  "workspace",
  "cwd",
  "detail",
  "details",
  "error",
  "reason",
  "stack",
  "userid",
  "ownerid",
  "conversationid",
  "sandboxid",
]);

function normalizedKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SECRET_KEYS.has(normalized) || SECRET_KEYS.has(normalized.replace(/_/g, ""));
}

function isContentKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return CONTENT_KEYS.has(normalized) || normalized.endsWith("content") || normalized.endsWith("payload");
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|credential|password)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, MAX_LOG_MESSAGE_LENGTH);
}

function summarizeContent(value: unknown): unknown {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).length };
  return value === undefined ? "undefined" : typeof value;
}

export function summarizeDevValue(
  value: unknown,
  key?: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message) };
  }
  if (key && isSecretKey(key)) return REDACTED;
  if (key && isContentKey(key)) return summarizeContent(value);
  if (key && normalizedKey(key).endsWith("id") && typeof value === "string") {
    return redactText(value).slice(0, 16);
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return key === undefined ? summarizeContent(value) : redactText(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "[function]";
  if (depth >= MAX_LOG_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return typeof value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).slice(0, 32).map(([childKey, child]) => [
      childKey,
      summarizeDevValue(child, childKey, depth + 1, seen),
    ]),
  );
}

function serialize(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? "[undefined]").slice(0, MAX_LOG_MESSAGE_LENGTH);
  } catch {
    return "[unserializable]";
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined"
    && typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

export function stopDevLogging(): void {
  loggingEnabled = false;
}

export function isDevLoggingEnabled(): boolean {
  return import.meta.env.DEV && loggingEnabled;
}

/**
 * Dev-only logging: writes to the browser console and forwards to the Rust
 * terminal. No-ops outside development builds. Never throws.
 */
export function devLog(
  level: DevLogLevel,
  source: string,
  message: string,
  data?: unknown,
): void {
  if (!isDevLoggingEnabled()) return;
  const line = `[dev:${source}] ${redactText(message)}`;
  const safeData = data === undefined ? undefined : summarizeDevValue(data);
  const logFn = console[CONSOLE_FN[level]];
  if (safeData === undefined) {
    logFn(line);
  } else {
    logFn(line, safeData);
  }
  if (isTauriRuntime()) {
    const terminalMessage = safeData === undefined ? line : `${line} ${serialize(safeData)}`;
    void invoke("debug_log", { level, message: terminalMessage }).catch(() => undefined);
  }
}
