import { loggedInvoke, getSessionToken } from "@/lib/utils/utils";
import type { ChatMessage } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { connectionsClient } from "@/features/connections/client";
import { getRepository } from "@/lib/repositories";
import { devLog } from "@/features/debug-overlay/devLog";

export interface TitleStore {
  findConversation(id: string): { title: string; titleSource?: string; isTemporary?: boolean } | undefined;
  getConversationMessages(conversationId: string): ChatMessage[];
  loadConversationMessages?: (conversationId: string) => Promise<ChatMessage[]>;
  setTitleGenerationStatus(conversationId: string, status: "generating" | "done" | "failed"): void;
  renameConversation(id: string, title: string, source: "generated"): Promise<void>;
}

type GenerateTitleArgs = {
  conversationId: string;
  model: string;
  userName?: string;
};

export const titleStore: TitleStore = {
  findConversation: (id) =>
    useChatStore.getState().conversations.find((c) => c.id === id),
  getConversationMessages: (cid) =>
    useChatStore.getState().messages.filter((m) => m.conversationId === cid),
  loadConversationMessages: (cid) => getRepository().getMessages(cid, 50, 0),
  setTitleGenerationStatus: (id, status) =>
    useChatStore.getState().actions.setTitleGenerationStatus?.(id, status),
  renameConversation: (id, title, source) =>
    useChatStore.getState().actions.renameConversation(id, title, source),
};

const pendingTitleGenerations = new Set<string>();
const TITLE_GENERATION_DELAY_MS = 0;

const REJECTED_TITLES = new Set([
  "new chat", "untitled", "chat", "conversation", "help",
  "greeting", "greetings", "hi", "hello", "hey",
]);

function hasCustomTitle(conversation: { title: string; titleSource?: string }): boolean {
  if (conversation.titleSource === "manual") return true;
  if (conversation.titleSource === "generated") return true;
  const title = conversation.title?.trim().toLowerCase();
  return Boolean(title) && !["new chat", "iphone"].includes(title);
}

export function sanitizeTitle(raw: string | null | undefined, userMessage?: string): string | null {
  if (!raw) return null;
  let t = raw.trim();
  if (!t || t.length < 2) return null;
  if (t.includes("\n")) return null;
  if (/```/.test(t)) return null;
  t = t.replace(/[<>]/g, "");
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/\.$/, "");
  t = t.replace(/[#*_~`>|\\]/g, "");
  t = t.replace(/\s+/g, " ");
  if (t.length > 48) return null;
  if (userMessage) {
    const userNorm = userMessage.replace(/[^a-z0-9\s]/gi, "").toLowerCase().trim();
    const titleNorm = t.replace(/[^a-z0-9\s]/gi, "").toLowerCase().trim();
    if (userNorm.startsWith(titleNorm) && userNorm.length > titleNorm.length) return null;
  }
  const lower = t.toLowerCase();
  if (REJECTED_TITLES.has(lower)) return null;
  if (/^(i|i'm|i'll|i'd|i've|me|my|you|your|we|let's)\b/i.test(t)) return null;
  if (t.includes("{") && t.includes("}")) {
    const braceCount = (t.match(/{/g) || []).length + (t.match(/}/g) || []).length;
    if (braceCount > 4) return null;
  }
  if (/function\s*\(|tool_call|<\|(fim|channel)|\$\{|process\.\w+/.test(t)) return null;
  if (/^\d+$/.test(t)) return null;
  return t;
}

export function fallbackFromFirstUser(content: string): string {
  let clean = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[`"'\u201C\u201D]/g, "")
    .trim();
  if (clean.length > 40) clean = clean.slice(0, 40).trimEnd();

  const fileMatch = content.match(/(?:edit|create|add|update|delete|remove|rename)\s+.*?(\S+\.\w+)/i);
  if (fileMatch) return `Edit ${fileMatch[1]}`;

  const topicPatterns = [
    /(?:help\s+me\s+)?(?:understand|learn|explain|know|figure\s+out)\s+(?:what|how|why|about\s+)?(.+)/i,
    /(?:tell|talk|speak)\s+me\s+about\s+(.+)/i,
    /(?:i\s+need\s+(?:you\s+to\s+)?|could\s+you|can\s+you|would\s+you)\s+(?:help\s+)?(.+)/i,
    /what\s+is\s+(.+)/i,
    /explain\s+(.+)/i,
    /describe\s+(.+)/i,
    /show\s+me\s+(.+)/i,
  ];
  for (const pat of topicPatterns) {
    const m = content.match(pat);
    if (m) {
      const topic = m[1]
        .replace(/[?.!,;]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (topic && topic.length >= 3) {
        const topicWords = topic.split(/\s+/).slice(0, 5);
        if (topicWords.length < 4) return topicWords.join(" ");
        return topicWords.map((w, i) => i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
      }
    }
  }

  const qwords = clean.split(/\s+/);
  const first = qwords[0]?.toLowerCase() ?? "";
  const questionWords = ["what", "how", "why", "when", "where", "who", "is", "are", "can", "does", "do", "explain", "describe"];
  if (questionWords.includes(first)) {
    const rest = qwords.slice(1, 5);
    if (rest.length === 0) return first.charAt(0).toUpperCase() + first.slice(1);
    return rest.map((w, i) => {
      const stripped = w.replace(/[?.!,;]+$/, "");
      return i === 0 ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : stripped;
    }).filter(Boolean).join(" ");
  }

  const words = qwords.slice(0, 6);
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.map((w, i) => i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
}

export function shouldGenerateTitle(store: TitleStore, conversationId: string): boolean {
  if (pendingTitleGenerations.has(conversationId)) return false;

  const conversation = store.findConversation(conversationId);
  if (!conversation || conversation.isTemporary) return false;
  if (hasCustomTitle(conversation)) return false;

  const conversationMessages = store.getConversationMessages(conversationId);
  const hasUser = conversationMessages.some((message) => message.role === "user");
  const hasAssistant = conversationMessages.some(
    (m) => m.role === "assistant" && m.content?.trim() && m.status === "complete",
  );
  return hasUser && hasAssistant;
}

export function queueTitleGeneration(store: TitleStore, {
  conversationId,
  model,
  userName,
}: GenerateTitleArgs): void {
  if (!model || !shouldGenerateTitle(store, conversationId)) return;
  scheduleTitleGeneration(store, conversationId, model, userName);
}

export function retryTitleForConversation(store: TitleStore, conversationId: string): void {
  if (pendingTitleGenerations.has(conversationId)) return;

  const conversation = store.findConversation(conversationId);
  if (!conversation || conversation.isTemporary) return;
  if (hasCustomTitle(conversation)) return;

  void loadMessagesForTitle(store, conversationId).then((conversationMessages) => {
    if (pendingTitleGenerations.has(conversationId)) return;
    const current = store.findConversation(conversationId);
    if (!current || current.isTemporary || hasCustomTitle(current)) return;

    const hasUserMessage = conversationMessages.some((message) => message.role === "user");
    if (!hasUserMessage) return;

    const lastAssistant = [...conversationMessages]
      .reverse()
      .find((m) => m.role === "assistant");
    const model = lastAssistant?.model ?? "";
    if (!model) return;

    scheduleTitleGeneration(store, conversationId, model);
  });
}

export function triggerTitleGeneration(store: TitleStore, conversationId: string): void {
  if (pendingTitleGenerations.has(conversationId)) return;
  const conversation = store.findConversation(conversationId);
  if (!conversation || conversation.isTemporary) return;
  if (hasCustomTitle(conversation)) return;

  const convMessages = store.getConversationMessages(conversationId);
  const firstUser = convMessages.find((m) => m.role === "user");
  const lastAssistant = [...convMessages].reverse().find(
    (m) => m.role === "assistant" && m.content?.trim() && m.status === "complete",
  );
  if (!firstUser || !lastAssistant) return;

  const model = lastAssistant.model ?? "";
  if (!model) return;

  scheduleTitleGeneration(store, conversationId, model);
}

function scheduleTitleGeneration(
  store: TitleStore,
  conversationId: string,
  model: string,
  userName?: string,
): void {
  pendingTitleGenerations.add(conversationId);
  store.setTitleGenerationStatus(conversationId, "generating");

  window.setTimeout(() => {
    void generateAndApplyTitle(store, conversationId, model, userName)
      .catch((error) => {
        devLog("warn", "title-generation", "Title generation failed", error);
      });
  }, TITLE_GENERATION_DELAY_MS);
}

async function generateAndApplyTitle(
  store: TitleStore,
  conversationId: string,
  model: string,
  userName?: string,
): Promise<void> {
  const convMessages = await loadMessagesForTitle(store, conversationId);
  const firstUser = convMessages.find((m) => m.role === "user");
  const firstAssistant = [...convMessages].reverse().find(
    (m) => m.role === "assistant" && m.content?.trim() && m.status === "complete",
  );
  const titleMessages: ChatMessage[] = [];
  if (firstUser) titleMessages.push(firstUser);
  if (firstAssistant) titleMessages.push(firstAssistant);
  if (titleMessages.length < 2) {
    pendingTitleGenerations.delete(conversationId);
    store.setTitleGenerationStatus(conversationId, "failed");
    return;
  }

  let title: string | null = null;
  try {
    const runtime = await connectionsClient.getRuntime(conversationId);
    if (runtime?.kind !== "chat-model") throw new Error("Chat model unavailable");
    const result = await loggedInvoke<{ text: string }>("ai_runtime_generate", {
      requestId: crypto.randomUUID(),
      connectionId: runtime.connection_id,
      modelId: runtime.model_id || model,
      prompt: titleMessages
        .map((message) => `${message.role === "assistant" ? "Assistant" : userName ?? "User"}: ${message.content}`)
        .join("\n"),
      instructions: "Generate a concise 2-5 word chat title without emoji. Return only the title.",
      token: getSessionToken(),
    });
    title = result.text;
  } catch (err) {
    devLog("warn", "title-generation", "Title generation invoke failed", err);
  }

  let finalTitle = sanitizeTitle(title, firstUser?.content);
  if (!finalTitle && firstUser) {
    finalTitle = fallbackFromFirstUser(firstUser.content);
  }

  const conversation = store.findConversation(conversationId);
  if (!conversation) {
    pendingTitleGenerations.delete(conversationId);
    return;
  }
  if (hasCustomTitle(conversation)) {
    pendingTitleGenerations.delete(conversationId);
    return;
  }

  if (finalTitle) {
    await store.renameConversation(conversationId, finalTitle, "generated");
    store.setTitleGenerationStatus(conversationId, "done");
  } else {
    store.setTitleGenerationStatus(conversationId, "failed");
  }

  pendingTitleGenerations.delete(conversationId);
}

async function loadMessagesForTitle(store: TitleStore, conversationId: string): Promise<ChatMessage[]> {
  const current = store.getConversationMessages(conversationId);
  const hasUser = current.some((message) => message.role === "user");
  const hasCompletedAssistant = current.some(
    (message) => message.role === "assistant" && message.content?.trim() && message.status === "complete",
  );
  if ((hasUser && hasCompletedAssistant) || !store.loadConversationMessages) return current;

  try {
    const loaded = await store.loadConversationMessages(conversationId);
    return loaded.length ? loaded : current;
  } catch (error) {
    devLog("warn", "title-generation", "Could not load messages for title generation", error);
    return current;
  }
}
