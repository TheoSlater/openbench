import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type OnToolExecutionEndCallback,
  type OnToolExecutionStartCallback,
  type UIMessageChunk,
} from "ai";
import type { ChatCommand } from "./protocol";
import { createModel } from "./providers";
import { ptyBroker, type PtyBroker } from "./terminal";
import { createToolRegistry } from "./tools";

const TOOL_APPROVAL_SECRET = crypto.randomUUID();

type RuntimeDeps = {
  model?: LanguageModel;
  fetch?: typeof fetch;
  terminalBroker?: PtyBroker;
  terminalApproval?: "user-approval" | "not-applicable";
  onToolExecutionStart?: OnToolExecutionStartCallback;
  onToolExecutionEnd?: OnToolExecutionEndCallback;
};

function withSearchSources(
  stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (chunk.type !== "tool-output-available") return;
      const output = chunk.output as {
        results?: Array<{ url?: string; title?: string }>;
      } | undefined;
      for (const [index, result] of (output?.results ?? []).entries()) {
        if (!result.url) continue;
        controller.enqueue({
          type: "source-url",
          sourceId: `${chunk.toolCallId}:${index}`,
          url: result.url,
          title: result.title,
        });
      }
    },
  }));
}

export async function streamChat(
  command: ChatCommand,
  abortSignal: AbortSignal,
  deps: RuntimeDeps = {},
): Promise<ReadableStream<UIMessageChunk>> {
  const model = deps.model ?? await createModel(command.connection, deps.fetch);
  return createUIMessageStream({
    originalMessages: command.messages,
    onError: (error) => error instanceof Error ? error.message : "Model request failed",
    execute: async ({ writer }) => {
      const previous = command.messages.at(-1);
      writer.write({
        type: "start",
        messageId: command.responseMessageId
          ?? (previous?.role === "assistant" ? previous.id : crypto.randomUUID()),
      });
      const registry = createToolRegistry({
        webSearch: command.webSearch,
        terminal: command.terminal,
        sandboxId: command.conversationId ?? command.requestId,
        fetch: deps.fetch,
        terminalBroker: deps.terminalBroker,
        terminalStart: ({ toolCallId, command: shellCommand, cwd, sandboxId }) => {
          writer.write({
            type: "data-terminal",
            id: toolCallId,
            data: {
              kind: "start",
              command: shellCommand,
              ...(cwd ? { cwd } : {}),
              ...(sandboxId ? { sandboxId } : {}),
            },
          });
        },
        activeTools: command.activeTools,
        toolOrder: command.toolOrder,
        toolChoice: command.toolChoice,
        terminalApproval: deps.terminalApproval,
      });
      const messages = await convertToModelMessages(command.messages, {
        tools: registry.tools,
      });
      const result = streamText({
        model,
        instructions: command.instructions,
        messages,
        abortSignal,
        reasoning: command.reasoning,
        tools: registry.tools,
        activeTools: registry.activeTools,
        toolOrder: registry.toolOrder,
        toolChoice: registry.toolChoice,
        toolApproval: registry.toolApproval,
        experimental_toolApprovalSecret: TOOL_APPROVAL_SECRET,
        onToolExecutionStart: deps.onToolExecutionStart,
        onToolExecutionEnd: deps.onToolExecutionEnd,
        stopWhen: isStepCount(10),
      });
      writer.merge(withSearchSources(toUIMessageStream({
        stream: result.stream,
        tools: registry.tools,
        sendStart: false,
        sendReasoning: true,
        sendSources: true,
        messageMetadata: ({ part }) => part.type === "finish"
          ? { usage: part.totalUsage, finishReason: part.finishReason }
          : undefined,
        onError: (error) => error instanceof Error ? error.message : "Model request failed",
      })));
    },
  });
}

export async function generate(
  model: LanguageModel,
  prompt: string,
  instructions?: string,
  abortSignal?: AbortSignal,
): Promise<{ text: string; usage: unknown; finishReason: string }> {
  const result = await generateText({ model, prompt, instructions, abortSignal });
  return {
    text: result.text,
    usage: result.totalUsage,
    finishReason: result.finishReason,
  };
}
