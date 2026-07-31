import { z } from "zod";
import type { UIMessage, UIMessageChunk } from "ai";

const providerSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "ollama",
  "lmstudio",
  "openai-compatible",
  "vercel-gateway",
]);

const connectionSchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  modelId: z.string().min(1),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
});

const chatSchema = z.object({
  type: z.literal("chat"),
  requestId: z.string().min(1),
  responseMessageId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  connection: connectionSchema,
  messages: z.array(z.custom<UIMessage>()),
  instructions: z.string().optional(),
  reasoning: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  webSearch: z.object({
    provider: z.enum(["local", "exa", "ollama", "tavily"]),
    secret: z.string().optional(),
    baseUrl: z.string().url().optional(),
  }).optional(),
});

const commandSchema = z.discriminatedUnion("type", [
  chatSchema,
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }),
  z.object({
    type: z.literal("approval"),
    requestId: z.string().min(1),
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("list-models"),
    requestId: z.string().min(1),
    connection: connectionSchema.omit({ modelId: true }).extend({
      modelId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("validate"),
    requestId: z.string().min(1),
    connection: connectionSchema,
  }),
  z.object({
    type: z.literal("generate"),
    requestId: z.string().min(1),
    connection: connectionSchema,
    instructions: z.string().optional(),
    prompt: z.string().min(1),
  }),
  z.object({ type: z.literal("shutdown") }),
]);

export type RuntimeCommand = z.infer<typeof commandSchema>;
export type ChatCommand = z.infer<typeof chatSchema>;
export type RuntimeConnection = ChatCommand["connection"];

export type RuntimeRecord =
  | { type: "ready" }
  | { type: "chunk"; requestId: string; chunk: UIMessageChunk }
  | { type: "done"; requestId: string }
  | { type: "result"; requestId: string; result: unknown }
  | { type: "error"; requestId: string; error: string | Error }
  | { type: "log"; level: "warn" | "error"; message: string };

const SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "password",
  "secret",
  "token",
  "x-api-key",
]);

const normalizedKey = (key: string) => key.trim().toLowerCase().replaceAll("-", "_");

function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SECRET_KEYS.has(normalized) || SECRET_KEYS.has(normalized.replaceAll("_", ""));
}

export function assertNoFrontendSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoFrontendSecrets);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) {
      throw new Error(`Frontend request contains secret-bearing field: ${key}`);
    }
    assertNoFrontendSecrets(child);
  }
}

export function redact(value: unknown): unknown {
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSecretKey(key) ? "[REDACTED]" : redact(child),
    ]),
  );
}

export function parseCommand(line: string): RuntimeCommand {
  return commandSchema.parse(JSON.parse(line));
}

export function encodeRecord(record: RuntimeRecord, secrets: string[] = []): string {
  const safe = record.type === "error"
    ? { ...record, error: record.error instanceof Error ? record.error.message : record.error }
    : record;
  let encoded = JSON.stringify(redact(safe));
  for (const secret of secrets) {
    if (secret) encoded = encoded.replaceAll(secret, "[REDACTED]");
  }
  return encoded;
}
