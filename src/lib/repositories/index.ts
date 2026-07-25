import Database from "@tauri-apps/plugin-sql";
import { ConversationRepository, mapRowToConversation, mapRowToMessage } from "./types";
import { Message, Conversation, Folder, ConversationMetadata } from "@/types/chat";

export type { ConversationRepository } from "./types";

class SqliteConversationRepository implements ConversationRepository {
  constructor(private db: Database) {}

  async getConversations(userId?: string): Promise<Conversation[]> {
    const rows = await this.db.select<{ id: string; title: string; createdAt: string; updatedAt: string; isArchived: number; folderId?: string; metadata?: string }[]>(
      userId
        ? "SELECT * FROM conversations WHERE userId = ? ORDER BY updatedAt DESC"
        : "SELECT * FROM conversations ORDER BY updatedAt DESC",
      userId ? [userId] : []
    );
    return rows.map(mapRowToConversation);
  }

  async createConversation(id: string, title: string, userId?: string, folderId?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      userId
        ? "INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived, userId, folderId) VALUES (?, ?, ?, ?, 0, ?, ?)"
        : "INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived, folderId) VALUES (?, ?, ?, ?, 0, ?)",
      userId ? [id, title, now, now, userId, folderId || null] : [id, title, now, now, folderId || null]
    );
  }

  async updateConversation(id: string, updates: { title?: string; updatedAt?: string; isArchived?: boolean; folderId?: string | null; metadata?: ConversationMetadata | null }): Promise<void> {
    const clauses: string[] = [];
    const vals: unknown[] = [];
    if (updates.title !== undefined) { clauses.push("title = ?"); vals.push(updates.title); }
    if (updates.updatedAt !== undefined) { clauses.push("updatedAt = ?"); vals.push(updates.updatedAt); }
    if (updates.isArchived !== undefined) { clauses.push("isArchived = ?"); vals.push(updates.isArchived ? 1 : 0); }
    if (updates.folderId !== undefined) { clauses.push("folderId = ?"); vals.push(updates.folderId); }
    if (updates.metadata !== undefined) { clauses.push("metadata = ?"); vals.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
    if (clauses.length === 0) return;
    vals.push(id);
    await this.db.execute(`UPDATE conversations SET ${clauses.join(", ")} WHERE id = ?`, vals);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.execute("DELETE FROM messages WHERE conversationId = ?", [id]);
    await this.db.execute("DELETE FROM conversations WHERE id = ?", [id]);
  }

  async deleteConversations(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.execute(`DELETE FROM messages WHERE conversationId IN (${placeholders})`, ids);
    await this.db.execute(`DELETE FROM conversations WHERE id IN (${placeholders})`, ids);
  }

  async deleteAllConversations(userId: string): Promise<void> {
    await this.db.execute("DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE userId = ?)", [userId]);
    await this.db.execute("DELETE FROM conversations WHERE userId = ?", [userId]);
  }

  async clearConversationFolders(folderIds: string[]): Promise<void> {
    if (folderIds.length === 0) return;
    const placeholders = folderIds.map(() => "?").join(",");
    await this.db.execute(`UPDATE conversations SET folderId = NULL WHERE folderId IN (${placeholders})`, folderIds);
  }

  async getMessages(conversationId: string, limit: number, offset: number): Promise<Message[]> {
    const rows = await this.db.select<{ id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: string; model?: string; provider?: Message["provider"]; thinking?: string; thinkingDuration?: number; webSearch?: string; status?: Message["status"]; errorMessage?: string }[]>(
      "SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?",
      [conversationId, limit, offset]
    );
    return rows.map(mapRowToMessage).reverse();
  }

  async getAllMessages(userId?: string): Promise<Message[]> {
    const rows = await this.db.select<{ id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: string; model?: string; provider?: Message["provider"]; thinking?: string; thinkingDuration?: number; webSearch?: string; status?: Message["status"]; errorMessage?: string }[]>(
      userId
        ? "SELECT messages.* FROM messages INNER JOIN conversations ON conversations.id = messages.conversationId WHERE conversations.userId = ? ORDER BY messages.conversationId ASC, messages.createdAt ASC"
        : "SELECT * FROM messages ORDER BY conversationId ASC, createdAt ASC",
      userId ? [userId] : [],
    );
    return rows.map(mapRowToMessage);
  }

  async addMessage(message: Message): Promise<void> {
    await this.db.execute(
      "INSERT INTO messages (id, conversationId, role, content, createdAt, attachments, model, provider, thinking, thinkingDuration, webSearch, status, errorMessage, memoryUpdates) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        message.id, message.conversationId, message.role, message.content, message.createdAt,
        message.attachments ? JSON.stringify(message.attachments) : null,
        message.model || null, message.provider || null, message.thinking || null, message.thinkingDuration || null,
        message.webSearch ? JSON.stringify(message.webSearch) : null,
        message.status || null,
        message.errorMessage || null,
        message.memoryUpdates?.length ? JSON.stringify(message.memoryUpdates) : null,
      ]
    );
    await this.db.execute("UPDATE conversations SET updatedAt = ? WHERE id = ?", [message.createdAt, message.conversationId]);
  }

  async setMessageMemoryUpdates(messageId: string, summaries: string[]): Promise<void> {
    await this.db.execute(
      "UPDATE messages SET memoryUpdates = ? WHERE id = ?",
      [summaries.length ? JSON.stringify(summaries) : null, messageId],
    );
  }

  async deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
    const target = await this.db.select<{ createdAt: string }[]>("SELECT createdAt FROM messages WHERE id = ?", [messageId]);
    if (target.length === 0) return;
    await this.db.execute("DELETE FROM messages WHERE conversationId = ? AND createdAt >= ?", [conversationId, target[0].createdAt]);
  }

  async transferConversations(fromUserId: string, toUserId: string): Promise<void> {
    await this.db.execute("UPDATE conversations SET userId = ? WHERE userId = ?", [toUserId, fromUserId]);
  }

  async getFolders(userId?: string): Promise<Folder[]> {
    const rows = await this.db.select<{ id: string; name: string; parentId?: string; backgroundImage?: string; systemPrompt?: string; contextFiles?: string; userId?: string; createdAt: string; updatedAt: string }[]>(
      userId
        ? "SELECT * FROM folders WHERE userId = ? ORDER BY createdAt ASC"
        : "SELECT * FROM folders ORDER BY createdAt ASC",
      userId ? [userId] : []
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId || undefined,
      backgroundImage: row.backgroundImage || undefined,
      systemPrompt: row.systemPrompt || undefined,
      contextFiles: row.contextFiles ? JSON.parse(row.contextFiles) : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async createFolder(id: string, name: string, userId?: string, parentId?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      userId
        ? "INSERT INTO folders (id, name, createdAt, updatedAt, userId, parentId) VALUES (?, ?, ?, ?, ?, ?)"
        : "INSERT INTO folders (id, name, createdAt, updatedAt, parentId) VALUES (?, ?, ?, ?, ?)",
      userId ? [id, name, now, now, userId, parentId || null] : [id, name, now, now, parentId || null]
    );
  }

  async updateFolder(id: string, updates: { name?: string; parentId?: string | null; backgroundImage?: string | null; systemPrompt?: string | null; contextFiles?: string | null; updatedAt?: string }): Promise<void> {
    const clauses: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { clauses.push("name = ?"); vals.push(updates.name); }
    if (updates.parentId !== undefined) { clauses.push("parentId = ?"); vals.push(updates.parentId); }
    if (updates.backgroundImage !== undefined) { clauses.push("backgroundImage = ?"); vals.push(updates.backgroundImage); }
    if (updates.systemPrompt !== undefined) { clauses.push("systemPrompt = ?"); vals.push(updates.systemPrompt); }
    if (updates.contextFiles !== undefined) { clauses.push("contextFiles = ?"); vals.push(updates.contextFiles); }
    if (updates.updatedAt !== undefined) { clauses.push("updatedAt = ?"); vals.push(updates.updatedAt); }
    if (clauses.length === 0) return;
    vals.push(id);
    await this.db.execute(`UPDATE folders SET ${clauses.join(", ")} WHERE id = ?`, vals);
  }

  async deleteFolder(id: string): Promise<void> {
    await this.db.execute("DELETE FROM folders WHERE id = ?", [id]);
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  private conversations: Record<string, { id: string; title: string; createdAt: string; updatedAt: string; isArchived: boolean; userId?: string; folderId?: string; metadata?: ConversationMetadata }> = {};
  private messages: Record<string, Message[]> = {};
  private folders: Record<string, Folder & { userId?: string }> = {};

  async getConversations(userId?: string): Promise<Conversation[]> {
    return Object.values(this.conversations)
      .filter((c) => !userId || c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createConversation(id: string, title: string, userId?: string, folderId?: string): Promise<void> {
    const now = new Date().toISOString();
    this.conversations[id] = { id, title, createdAt: now, updatedAt: now, isArchived: false, userId, folderId };
    this.messages[id] = [];
  }

  async updateConversation(id: string, updates: { title?: string; updatedAt?: string; isArchived?: boolean; folderId?: string | null; metadata?: ConversationMetadata | null }): Promise<void> {
    const conv = this.conversations[id];
    if (!conv) return;
    if (updates.title !== undefined) conv.title = updates.title;
    if (updates.updatedAt !== undefined) conv.updatedAt = updates.updatedAt;
    if (updates.isArchived !== undefined) conv.isArchived = updates.isArchived;
    if (updates.folderId !== undefined) conv.folderId = updates.folderId ?? undefined;
    if (updates.metadata !== undefined) conv.metadata = updates.metadata ?? undefined;
  }

  async deleteConversation(id: string): Promise<void> {
    delete this.conversations[id];
    delete this.messages[id];
  }

  async deleteConversations(ids: string[]): Promise<void> {
    for (const id of ids) {
      delete this.conversations[id];
      delete this.messages[id];
    }
  }

  async deleteAllConversations(userId: string): Promise<void> {
    for (const [id, conv] of Object.entries(this.conversations)) {
      if (conv.userId === userId) {
        delete this.conversations[id];
        delete this.messages[id];
      }
    }
  }

  async clearConversationFolders(folderIds: string[]): Promise<void> {
    const ids = new Set(folderIds);
    for (const [id, conv] of Object.entries(this.conversations)) {
      if (conv.folderId && ids.has(conv.folderId)) {
        this.conversations[id] = { ...conv, folderId: undefined };
      }
    }
  }

  async getMessages(conversationId: string, limit: number, offset: number): Promise<Message[]> {
    const all = [...(this.messages[conversationId] ?? [])];
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(offset, offset + limit).reverse();
  }

  async getAllMessages(userId?: string): Promise<Message[]> {
    const conversationIds = new Set(
      Object.values(this.conversations)
        .filter((conversation) => !userId || conversation.userId === userId)
        .map((conversation) => conversation.id),
    );
    return Object.values(this.messages)
      .flat()
      .filter((message) => conversationIds.has(message.conversationId))
      .sort((a, b) =>
        a.conversationId === b.conversationId
          ? a.createdAt.localeCompare(b.createdAt)
          : a.conversationId.localeCompare(b.conversationId),
      );
  }

  async addMessage(message: Message): Promise<void> {
    const list = this.messages[message.conversationId] ?? [];
    this.messages[message.conversationId] = [...list, message];
    if (this.conversations[message.conversationId]) {
      this.conversations[message.conversationId].updatedAt = message.createdAt;
    }
  }

  async setMessageMemoryUpdates(messageId: string, summaries: string[]): Promise<void> {
    for (const [conversationId, msgs] of Object.entries(this.messages)) {
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        const next = [...msgs];
        next[idx] = { ...next[idx], memoryUpdates: summaries.length ? summaries : undefined };
        this.messages[conversationId] = next;
        return;
      }
    }
  }

  async deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
    const msgs = this.messages[conversationId] ?? [];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx !== -1) this.messages[conversationId] = msgs.slice(0, idx);
  }

  async transferConversations(fromUserId: string, toUserId: string): Promise<void> {
    for (const [id, conv] of Object.entries(this.conversations)) {
      if (conv.userId === fromUserId) {
        this.conversations[id] = { ...conv, userId: toUserId };
      }
    }
  }

  async getFolders(userId?: string): Promise<Folder[]> {
    return Object.values(this.folders)
      .filter((f) => !userId || f.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createFolder(id: string, name: string, userId?: string, parentId?: string): Promise<void> {
    const now = new Date().toISOString();
    this.folders[id] = { id, name, parentId, createdAt: now, updatedAt: now, userId };
  }

  async updateFolder(id: string, updates: { name?: string; parentId?: string | null; backgroundImage?: string | null; systemPrompt?: string | null; contextFiles?: string | null; updatedAt?: string }): Promise<void> {
    const f = this.folders[id];
    if (!f) return;
    if (updates.name !== undefined) f.name = updates.name;
    if (updates.parentId !== undefined) f.parentId = updates.parentId ?? undefined;
    if (updates.backgroundImage !== undefined) f.backgroundImage = updates.backgroundImage ?? undefined;
    if (updates.systemPrompt !== undefined) f.systemPrompt = updates.systemPrompt ?? undefined;
    if (updates.contextFiles !== undefined) f.contextFiles = updates.contextFiles ? JSON.parse(updates.contextFiles) : undefined;
    if (updates.updatedAt !== undefined) f.updatedAt = updates.updatedAt;
  }

  async deleteFolder(id: string): Promise<void> {
    delete this.folders[id];
  }
}

let repository: ConversationRepository | null = null;

export async function initRepository(): Promise<ConversationRepository> {
  if (repository) return repository;

  const db = await loadDatabaseWithRetry("sqlite:chat.db");
  repository = new SqliteConversationRepository(db);
  if (DEV) console.log("[repo] SQLite repository active");

  return repository;
}

async function loadDatabaseWithRetry(path: string): Promise<Database> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Database.load(path);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  throw new Error(`SQLite repository failed to initialize: ${String(lastError)}`);
}

export function getRepository(): ConversationRepository {
  if (!repository) throw new Error("Repository not initialized");
  return repository;
}

// Injection seam for tests. Production startup must use initRepository().
export function setRepository(repo: ConversationRepository): void {
  repository = repo;
}

export function resetRepository(): void {
  repository = null;
}
