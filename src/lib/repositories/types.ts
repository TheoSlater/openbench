import { Message, Conversation, Folder, ConversationMetadata } from "@/types/chat";

export interface ConversationRepository {
  getConversations(userId?: string): Promise<Conversation[]>;
  createConversation(id: string, title: string, userId?: string, folderId?: string): Promise<void>;
  updateConversation(id: string, updates: { title?: string; updatedAt?: string; isArchived?: boolean; folderId?: string | null; metadata?: ConversationMetadata | null }): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  deleteConversations(ids: string[]): Promise<void>;
  deleteAllConversations(userId: string): Promise<void>;
  clearConversationFolders(folderIds: string[]): Promise<void>;

  getMessages(conversationId: string, limit: number, offset: number): Promise<Message[]>;
  getAllMessages(userId?: string): Promise<Message[]>;
  addMessage(message: Message): Promise<void>;
  setMessageMemoryUpdates(messageId: string, summaries: string[]): Promise<void>;
  deleteMessagesAfter(conversationId: string, messageId: string): Promise<void>;
  transferConversations(fromUserId: string, toUserId: string): Promise<void>;

  getFolders(userId?: string): Promise<Folder[]>;
  createFolder(id: string, name: string, userId?: string, parentId?: string): Promise<void>;
  updateFolder(id: string, updates: { name?: string; parentId?: string | null; backgroundImage?: string | null; systemPrompt?: string | null; contextFiles?: string | null; updatedAt?: string }): Promise<void>;
  deleteFolder(id: string): Promise<void>;
}

export function mapRowToConversation(row: { id: string; title: string; createdAt: string; updatedAt: string; isArchived: number; folderId?: string; metadata?: string }): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isArchived: Boolean(row.isArchived),
    folderId: row.folderId || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

export function mapRowToMessage(row: { id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: string; model?: string; provider?: Message["provider"]; thinking?: string; thinkingDuration?: number; webSearch?: string; status?: Message["status"]; errorMessage?: string; memoryUpdates?: string }): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    model: row.model,
    provider: row.provider,
    thinking: row.thinking,
    thinkingDuration: row.thinkingDuration,
    webSearch: row.webSearch ? JSON.parse(row.webSearch) : undefined,
    status: row.status,
    errorMessage: row.errorMessage,
    memoryUpdates: row.memoryUpdates ? JSON.parse(row.memoryUpdates) : undefined,
  };
}
