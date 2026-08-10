import {
  convertToModelMessages,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type TextStreamPart,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import type { CodexAppServerProvider } from "ai-sdk-provider-codex-cli";
import type { AgentCommand, AgentModelsCommand } from "./protocol";
import { ApprovalBroker, type AgentEvent } from "./approvals";

type RuntimeAgentEvent = Exclude<AgentEvent, { kind: "permission" }>;

type AgentModel = {
  model: LanguageModel;
  events?: RuntimeAgentEvent[];
  includeRawChunks?: boolean;
  close?: () => Promise<void>;
};
type AgentDeps = {
  approvals?: ApprovalBroker;
  createModel?: (command: AgentCommand, approvals: ApprovalBroker) => Promise<AgentModel>;
};

const codexProviders = new Map<string, CodexAppServerProvider>();

const inputString = (input: Record<string, unknown>, key: string) =>
  typeof input[key] === "string" ? input[key] : undefined;

function toolDetail(toolName: string, input: Record<string, unknown>) {
  const path = inputString(input, "file_path") ?? inputString(input, "path");
  return {
    action: toolName,
    command: inputString(input, "command"),
    paths: path ? [path] : undefined,
  };
}

async function claudeModel(command: AgentCommand, approvals: ApprovalBroker): Promise<AgentModel> {
  const { claudeCode } = await import("ai-sdk-provider-claude-code");
  const { agent } = command;
  const events: RuntimeAgentEvent[] = [];
  return {
    events,
    model: claudeCode(agent.modelId ?? "sonnet", {
      cwd: agent.workspace,
      pathToClaudeCodeExecutable: agent.executablePath,
      resume: agent.sessionId,
      permissionMode: "default",
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
      tools: { type: "preset", preset: "claude_code" },
      logger: false,
      onTaskEvent: (event) => {
        const description = "description" in event
          ? event.description
          : event.subtype === "task_updated"
            ? event.patch.description
            : undefined;
        events.push({
          kind: "task",
          id: event.taskId,
          text: description ?? event.subtype,
          status: event.subtype.replace("task_", ""),
        });
      },
      canUseTool: async (toolName, input, options) => {
        const safeRead = ["Read", "Glob", "Grep", "WebFetch", "WebSearch"].includes(toolName);
        if (agent.accessMode === "read-only" && !safeRead) {
          return { behavior: "deny", message: "This session is read-only." };
        }
        const decision = await approvals.request(
          command.requestId,
          options.toolUseID || options.requestId,
          { ...toolDetail(toolName, input), cwd: agent.workspace },
          options.signal,
        );
        return decision.approved
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: decision.reason ?? "User denied permission." };
      },
    }),
  };
}

async function codexProvider(path?: string): Promise<CodexAppServerProvider> {
  const key = path ?? "codex";
  const existing = codexProviders.get(key);
  if (existing) return existing;
  const { createCodexAppServer } = await import("ai-sdk-provider-codex-cli");
  const created = createCodexAppServer({ defaultSettings: { codexPath: path, logger: false } });
  codexProviders.set(key, created);
  return created;
}

async function codexModel(command: AgentCommand, approvals: ApprovalBroker): Promise<AgentModel> {
  const { agent } = command;
  const provider = await codexProvider(agent.executablePath);
  const modelId = agent.modelId ?? (await provider.listModels()).defaultModel?.id;
  if (!modelId) throw new Error("Codex did not report a default model.");
  const ask = async (approvalId: string, detail: Parameters<ApprovalBroker["request"]>[2]) =>
    approvals.request(command.requestId, approvalId, detail);
  return {
    includeRawChunks: true,
    model: provider(modelId, {
      cwd: agent.workspace,
      threadMode: "persistent",
      resume: agent.sessionId,
      approvalPolicy: "on-request",
      sandboxPolicy: agent.accessMode,
      autoApprove: false,
      includeRawChunks: true,
      effort: command.reasoning === "none" ? undefined : command.reasoning,
      serverRequests: {
        onCommandExecutionApproval: async ({ params }) => ({
          decision: (await ask(params.approvalId ?? params.itemId, {
            action: params.reason ?? "Run command",
            command: params.command ?? undefined,
            cwd: params.cwd ?? agent.workspace,
          })).approved ? "accept" : "decline",
        }),
        onFileChangeApproval: async ({ params }) => ({
          decision: (await ask(params.itemId, {
            action: params.reason ?? "Change files",
            paths: params.grantRoot ? [params.grantRoot] : undefined,
            cwd: agent.workspace,
          })).approved ? "accept" : "decline",
        }),
      },
    }),
  };
}

function rawAgentEvent(rawValue: unknown): RuntimeAgentEvent | undefined {
  if (!rawValue || typeof rawValue !== "object") return undefined;
  const raw = rawValue as { method?: unknown; params?: { item?: unknown } };
  if (!["item/started", "item/completed"].includes(String(raw.method))) return undefined;
  if (!raw.params?.item || typeof raw.params.item !== "object") return undefined;
  const item = raw.params.item as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
  const status = raw.method === "item/completed" ? "completed" : "running";
  if (item.type === "plan" && typeof item.text === "string") {
    return { kind: "plan", id, text: item.text, status };
  }
  if (item.type === "commandExecution") {
    return {
      kind: "terminal",
      id,
      command: typeof item.command === "string" ? item.command : undefined,
      cwd: typeof item.cwd === "string" ? item.cwd : undefined,
      status: typeof item.status === "string" ? item.status : status,
    };
  }
  if (item.type === "fileChange") {
    const paths = Array.isArray(item.changes)
      ? item.changes.flatMap((change) => {
        if (!change || typeof change !== "object") return [];
        const value = change as Record<string, unknown>;
        const path = value.path ?? value.filePath;
        return typeof path === "string" ? [path] : [];
      })
      : undefined;
    return {
      kind: "file",
      id,
      paths: paths?.length ? paths : undefined,
      status: typeof item.status === "string" ? item.status : status,
    };
  }
  return undefined;
}

const dataChunk = (event: RuntimeAgentEvent): UIMessageChunk => ({
  type: "data-agent",
  id: event.id,
  data: event,
});

function withAgentEvents(
  stream: ReadableStream<UIMessageChunk>,
  events: RuntimeAgentEvent[],
): ReadableStream<UIMessageChunk> {
  const tools = new Map<string, RuntimeAgentEvent>();
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      while (events.length) controller.enqueue(dataChunk(events.shift()!));
      if (chunk.type === "tool-input-available") {
        const name = chunk.toolName.toLowerCase();
        const detail = toolDetail(chunk.toolName, (chunk.input ?? {}) as Record<string, unknown>);
        const event: RuntimeAgentEvent | undefined = /exec|bash|shell|command/.test(name)
          ? { kind: "terminal", id: chunk.toolCallId, command: detail.command, status: "running" }
          : /edit|write|file|patch|notebook/.test(name)
            ? { kind: "file", id: chunk.toolCallId, paths: detail.paths, status: "running" }
            : undefined;
        if (event) {
          tools.set(chunk.toolCallId, event);
          controller.enqueue(dataChunk(event));
        }
      } else if (["tool-output-available", "tool-output-error", "tool-output-denied"].includes(chunk.type)) {
        const event = "toolCallId" in chunk ? tools.get(chunk.toolCallId) : undefined;
        if (event) controller.enqueue(dataChunk({
          ...event,
          status: chunk.type === "tool-output-available" ? "completed" : "failed",
        }));
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      while (events.length) controller.enqueue(dataChunk(events.shift()!));
    },
  }));
}

export type AgentModelEntry = { id: string; name?: string };
export type AgentModelsResult = {
  models: AgentModelEntry[];
  /** The agent's own default when the user has not chosen one. */
  defaultId?: string;
};

async function codexModels(path?: string): Promise<AgentModelsResult> {
  const provider = await codexProvider(path);
  const listed = await provider.listModels();
  return {
    models: (listed.models ?? [])
      .filter((model) => !model.hidden)
      .map((model) => ({
        id: model.id,
        name: model.displayName ?? model.name ?? model.model ?? undefined,
      })),
    defaultId: listed.defaultModel?.id,
  };
}

export async function listAgentModels(
  agent: AgentModelsCommand["agent"],
): Promise<AgentModelsResult> {
  return agent.kind === "claude-code"
    ? { models: [] }
    : codexModels(agent.executablePath);
}

export async function createAgentModel(
  command: AgentCommand,
  approvals: ApprovalBroker,
): Promise<AgentModel> {
  return command.agent.kind === "claude-code"
    ? claudeModel(command, approvals)
    : codexModel(command, approvals);
}

function sessionId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  for (const key of ["claude-code", "codex-app-server"]) {
    const value = (metadata as Record<string, unknown>)[key];
    if (value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string") {
      return (value as { sessionId: string }).sessionId;
    }
    if (value && typeof value === "object" && typeof (value as { threadId?: unknown }).threadId === "string") {
      return (value as { threadId: string }).threadId;
    }
  }
  return undefined;
}

export async function streamAgent(
  command: AgentCommand,
  abortSignal: AbortSignal,
  deps: AgentDeps = {},
): Promise<ReadableStream<UIMessageChunk>> {
  const approvals = deps.approvals ?? new ApprovalBroker(() => undefined);
  const created = await (deps.createModel ?? createAgentModel)(command, approvals);
  const result = streamText({
    model: created.model,
    instructions: command.instructions,
    messages: await convertToModelMessages(command.messages),
    abortSignal,
    include: created.includeRawChunks ? { rawChunks: true } : undefined,
  });
  let agentSessionId: string | undefined;
  const events = created.events ?? [];
  const observed = result.fullStream.pipeThrough(new TransformStream<
    TextStreamPart<ToolSet>,
    TextStreamPart<ToolSet>
  >({
    transform(part, controller) {
      if (part.type === "raw") {
        const event = rawAgentEvent(part.rawValue);
        if (event) events.push(event);
      } else {
        controller.enqueue(part);
      }
    },
  }));
  const stream = toUIMessageStream({
    stream: observed,
    originalMessages: command.messages,
    generateMessageId: command.responseMessageId ? () => command.responseMessageId! : undefined,
    sendReasoning: true,
    messageMetadata: ({ part }) => {
      if (part.type === "finish-step") {
        agentSessionId = sessionId(part.providerMetadata);
        return agentSessionId ? { agentSessionId } : undefined;
      }
      return part.type === "finish" ? {
        usage: part.totalUsage,
        finishReason: part.finishReason,
        ...(agentSessionId ? { agentSessionId } : {}),
      } : undefined;
    },
    onError: (error) => error instanceof Error ? error.message : "Coding agent failed",
  });
  const enriched = withAgentEvents(stream, events);
  if (!created.close) return enriched;
  return enriched.pipeThrough(new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); },
    async flush() { await created.close?.(); },
  }));
}

export async function closeAgentProviders(): Promise<void> {
  await Promise.all([...codexProviders.values()].map((provider) => provider.close()));
  codexProviders.clear();
}
