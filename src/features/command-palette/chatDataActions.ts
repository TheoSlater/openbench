import type { Conversation, Message } from "@/types/chat";
import { getRepository } from "@/lib/repositories";
import { useChatStore } from "@/store/chatStore";

export type NotifyApi = {
  success: (message: string) => void;
  error: (title: string, description?: string) => void;
};

type ImportedConversation = {
  conversation?: Partial<Conversation>;
  messages?: Partial<Message>[];
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  isArchived?: boolean;
};

function safeFileName(title: string) {
  return `${(title || "untitled").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
}

async function saveJson(fileName: string, json: string) {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: fileName,
    });
    if (!filePath) return false;
    await writeTextFile(filePath, json);
    return true;
  } catch {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }
}

async function readJsonFile(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath || Array.isArray(filePath)) return null;
    return await readTextFile(filePath);
  } catch {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.click();
    });
  }
}

export async function exportConversation(
  conversation: Conversation,
  notify: NotifyApi,
) {
  try {
    const repo = getRepository();
    const messages = await repo.getMessages(conversation.id, 99999, 0);
    const json = JSON.stringify({ conversation, messages }, null, 2);
    const saved = await saveJson(safeFileName(conversation.title), json);
    if (saved) notify.success("Conversation exported");
  } catch (error) {
    notify.error("Failed to export conversation", String(error));
  }
}

function normalizeImportPayload(payload: unknown): ImportedConversation[] {
  if (Array.isArray(payload)) return payload as ImportedConversation[];
  if (payload && typeof payload === "object") return [payload as ImportedConversation];
  return [];
}

export async function importConversations(notify: NotifyApi) {
  try {
    const text = await readJsonFile();
    if (!text) return;

    const repo = getRepository();
    const accountId = useChatStore.getState().accountId ?? undefined;
    const imported = normalizeImportPayload(JSON.parse(text));
    let firstImportedId: string | null = null;

    for (const item of imported) {
      const sourceConversation = item.conversation ?? item;
      const id = crypto.randomUUID();
      const createdAt = sourceConversation.createdAt ?? new Date().toISOString();
      const updatedAt = sourceConversation.updatedAt ?? createdAt;
      const title = sourceConversation.title ?? "Imported Chat";

      await repo.createConversation(id, title, accountId);
      await repo.updateConversation(id, {
        updatedAt,
        isArchived: Boolean(sourceConversation.isArchived),
      });

      for (const message of item.messages ?? []) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        await repo.addMessage({
          id: crypto.randomUUID(),
          conversationId: id,
          role: message.role,
          content: message.content ?? "",
          createdAt: message.createdAt ?? createdAt,
          attachments: message.attachments,
          model: message.model,
          provider: message.provider,
          thinking: message.thinking,
          thinkingDuration: message.thinkingDuration,
          webSearch: message.webSearch,
        });
      }

      firstImportedId ??= id;
    }

    await useChatStore.getState().actions.loadConversations();
    if (firstImportedId) {
      await useChatStore.getState().actions.setActiveConversationId(firstImportedId);
    }
    notify.success(`Imported ${imported.length} conversation${imported.length === 1 ? "" : "s"}`);
  } catch (error) {
    notify.error("Failed to import chat", String(error));
  }
}
