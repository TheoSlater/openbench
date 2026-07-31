import {
  convertToModelMessages,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type UIMessageChunk,
} from "ai";
import type { CodexAppServerProvider } from "ai-sdk-provider-codex-cli";
import type { AgentCommand } from "./protocol";
import { ApprovalBroker } from "./approvals";

type AgentModel = { model: LanguageModel; close?: () => Promise<void> };
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
  return {
    model: claudeCode(agent.modelId ?? "sonnet", {
      cwd: agent.workspace,
      pathToClaudeCodeExecutable: agent.executablePath,
      resume: agent.sessionId,
      permissionMode: "default",
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
      tools: { type: "preset", preset: "claude_code" },
      logger: false,
      canUseTool: async (toolName, input, options) => {
        const mutation = ["Bash", "Edit", "Write", "NotebookEdit"].includes(toolName);
        if (agent.accessMode === "read-only" && mutation) {
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
    model: provider(modelId, {
      cwd: agent.workspace,
      threadMode: "persistent",
      resume: agent.sessionId,
      approvalPolicy: "on-request",
      sandboxPolicy: agent.accessMode,
      autoApprove: false,
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
  });
  let agentSessionId: string | undefined;
  const stream = toUIMessageStream({
    stream: result.stream,
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
  if (!created.close) return stream;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); },
    async flush() { await created.close?.(); },
  }));
}

export async function closeAgentProviders(): Promise<void> {
  await Promise.all([...codexProviders.values()].map((provider) => provider.close()));
  codexProviders.clear();
}
