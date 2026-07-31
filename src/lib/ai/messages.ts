import type { UIMessage } from "ai";
import type { Message, SearchResultItem } from "@/types/chat";
import type { PolyUIData } from "./types";

type Metadata = {
  conversationId: string;
  createdAt: string;
  model?: string;
  provider?: Message["provider"];
  status?: Message["status"];
  errorMessage?: string;
  usage?: Message["usage"];
  finishReason?: Message["finishReason"];
  agentSessionId?: string;
};

export type PolyUIMessage = UIMessage<Metadata, PolyUIData>;
type Part = PolyUIMessage["parts"][number];

function fileUrl(content: string, mediaType: string): string {
  return content.startsWith("data:") ? content : `data:${mediaType};base64,${content}`;
}

export function toUIMessage(message: Message): PolyUIMessage {
  const parts: Part[] = [];
  if (message.thinking) parts.push({ type: "reasoning", text: message.thinking });
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const attachment of message.attachments ?? []) {
    if (!attachment.content) continue;
    parts.push({
      type: "file",
      mediaType: attachment.type,
      filename: attachment.name,
      url: fileUrl(attachment.content, attachment.type),
    });
  }
  parts.push(...(message.runtimeParts ?? []));
  return {
    id: message.id,
    role: message.role,
    metadata: {
      conversationId: message.conversationId,
      createdAt: message.createdAt,
      model: message.model,
      provider: message.provider,
      status: message.status,
      errorMessage: message.errorMessage,
      usage: message.usage,
      finishReason: message.finishReason,
      agentSessionId: message.agentSessionId,
    },
    parts,
  };
}

type EntityContext = {
  conversationId: string;
  model?: string;
  provider?: Message["provider"];
};

function toolName(part: Part): string | undefined {
  if (part.type === "dynamic-tool") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice(5);
  return undefined;
}

function webSearch(parts: Part[]): Message["webSearch"] {
  for (const part of parts) {
    if (toolName(part) !== "web_search") continue;
    const tool = part as Part & {
      toolCallId: string;
      state: string;
      input?: { query?: string };
      output?: { query?: string; results?: SearchResultItem[] };
    };
    if (tool.state !== "output-available") continue;
    const query = tool.output?.query ?? tool.input?.query ?? "";
    return {
      request_id: tool.toolCallId,
      query,
      status: "complete",
      results: tool.output?.results ?? [],
    };
  }
  return undefined;
}

export function fromUIMessage(
  message: PolyUIMessage,
  context: EntityContext,
): Message {
  const metadata = message.metadata;
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const thinking = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
  const attachments = message.parts
    .filter((part) => part.type === "file")
    .map((part, index) => ({
      id: `${message.id}:file:${index}`,
      name: part.filename ?? `attachment-${index + 1}`,
      type: part.mediaType,
      size: 0,
      content: part.url,
      status: "ready" as const,
    }));
  const runtimeParts = message.parts.filter(
    (part) => !["text", "reasoning", "file"].includes(part.type),
  );
  return {
    id: message.id,
    conversationId: context.conversationId,
    role: message.role === "user" ? "user" : "assistant",
    content: text,
    createdAt: metadata?.createdAt ?? new Date().toISOString(),
    attachments: attachments.length ? attachments : undefined,
    model: metadata?.model ?? context.model,
    provider: metadata?.provider ?? context.provider,
    thinking: thinking || undefined,
    status: metadata?.status,
    errorMessage: metadata?.errorMessage,
    webSearch: webSearch(message.parts),
    runtimeParts: runtimeParts.length ? runtimeParts : undefined,
    usage: metadata?.usage,
    finishReason: metadata?.finishReason,
    agentSessionId: metadata?.agentSessionId,
  };
}
