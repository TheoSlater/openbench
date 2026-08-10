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

const optional = <T extends z.ZodType>(schema: T) => schema.nullish()
  .transform((value) => value ?? undefined);

const connectionSchema = z.object({
  id: z.string().min(1),
  provider: providerSchema,
  modelId: z.string().min(1),
  baseUrl: optional(z.string().url()),
  headers: optional(z.record(z.string(), z.string())),
  secret: optional(z.string()),
});

const chatSchema = z.object({
  type: z.literal("chat"),
  requestId: z.string().min(1),
  responseMessageId: optional(z.string().min(1)),
  conversationId: optional(z.string().min(1)),
  connection: connectionSchema,
  messages: z.array(z.custom<UIMessage>()),
  instructions: optional(z.string()),
  reasoning: optional(z.enum(["none", "minimal", "low", "medium", "high", "xhigh"])),
  webSearch: optional(z.object({
    provider: z.enum(["local", "exa", "ollama", "tavily"]),
    secret: optional(z.string()),
    baseUrl: optional(z.string().url()),
  })),
  terminal: optional(z.boolean()),
  toolChoice: optional(z.union([
    z.enum(["auto", "required", "none"]),
    z.object({ type: z.literal("tool"), toolName: z.string().min(1) }),
  ])),
  activeTools: optional(z.array(z.string().min(1))),
  toolOrder: optional(z.array(z.string().min(1))),
  collectText: optional(z.boolean()),
});

const agentSchema = z.object({
  type: z.literal("agent"),
  requestId: z.string().min(1),
  responseMessageId: optional(z.string().min(1)),
  conversationId: z.string().min(1),
  agent: z.object({
    kind: z.enum(["claude-code", "codex"]),
    workspace: z.string().min(1),
    accessMode: z.enum(["read-only", "workspace-write"]),
    executablePath: optional(z.string().min(1)),
    modelId: optional(z.string().min(1)),
    sessionId: optional(z.string().min(1)),
  }),
  messages: z.array(z.custom<UIMessage>()),
  instructions: optional(z.string()),
  reasoning: optional(z.enum(["none", "minimal", "low", "medium", "high", "xhigh"])),
});

const agentModelsSchema = z.object({
  type: z.literal("agent-models"),
  requestId: z.string().min(1),
  agent: z.object({
    kind: z.enum(["claude-code", "codex"]),
    executablePath: optional(z.string().min(1)),
  }),
});

const commandSchema = z.discriminatedUnion("type", [
  chatSchema,
  agentSchema,
  agentModelsSchema,
  z.object({ type: z.literal("cancel"), requestId: z.string().min(1) }),
  z.object({
    type: z.literal("approval"),
    requestId: z.string().min(1),
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: optional(z.string()),
  }),
  z.object({
    type: z.literal("list-models"),
    requestId: z.string().min(1),
    connection: connectionSchema.omit({ modelId: true }).extend({
      modelId: optional(z.string()),
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
    instructions: optional(z.string()),
    prompt: z.string().min(1),
  }),
  z.object({
    type: z.literal("pty-data"),
    requestId: z.string().min(1),
    payload: z.object({
      data: z.array(z.number()),
    }),
  }),
  z.object({
    type: z.literal("pty-exit"),
    requestId: z.string().min(1),
    payload: z.object({
      exitCode: z.number().int().nullable(),
    }),
  }),
  z.object({ type: z.literal("shutdown") }),
]);

export type RuntimeCommand = z.infer<typeof commandSchema>;
export type ChatCommand = z.infer<typeof chatSchema>;
export type AgentCommand = z.infer<typeof agentSchema>;
export type AgentModelsCommand = z.infer<typeof agentModelsSchema>;
export type RuntimeConnection = ChatCommand["connection"];

export type RuntimeRecord =
  | { type: "ready" }
  | { type: "chunk"; requestId: string; chunk: UIMessageChunk }
  | { type: "done"; requestId: string }
  | { type: "result"; requestId: string; result: unknown }
  | { type: "error"; requestId: string; error: string | Error }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string };

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
    ? {
      ...record,
      error: redactText(record.error instanceof Error ? record.error.message : record.error),
    }
    : record.type === "log"
      ? { ...record, message: redactText(record.message) }
      : record;
  let encoded = JSON.stringify(redact(safe));
  for (const secret of secrets) {
    if (secret) encoded = encoded.replaceAll(secret, "[REDACTED]");
  }
  return encoded;
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|credential|password)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 1200);
}
