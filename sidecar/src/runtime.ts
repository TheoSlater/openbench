import {
  convertToModelMessages,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type UIMessageChunk,
} from "ai";
import type { ChatCommand } from "./protocol";
import { createModel } from "./providers";
import { createWebSearchTool } from "./web-search";

type RuntimeDeps = {
  model?: LanguageModel;
  fetch?: typeof fetch;
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
  const tools = command.webSearch
    ? { web_search: createWebSearchTool(command.webSearch, deps.fetch) }
    : undefined;
  const result = streamText({
    model,
    instructions: command.instructions,
    messages: await convertToModelMessages(command.messages),
    abortSignal,
    reasoning: command.reasoning,
    tools,
    stopWhen: isStepCount(10),
  });
  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools,
    originalMessages: command.messages,
    generateMessageId: command.responseMessageId ? () => command.responseMessageId! : undefined,
    sendReasoning: true,
    sendSources: true,
    messageMetadata: ({ part }) => part.type === "finish"
      ? { usage: part.totalUsage, finishReason: part.finishReason }
      : undefined,
    onError: (error) => error instanceof Error ? error.message : "Model request failed",
  });
  return withSearchSources(uiStream);
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
