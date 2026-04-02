import Database from "@tauri-apps/plugin-sql";

export type ConversationRow = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

let db: Database | null = null;
let inMemoryMode = false; // Will be set after initDB tries to connect

// Debug: log what we detected
console.log("[db] Environment check:", {
  hasWindow: typeof window !== "undefined",
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
});
const fallbackConversations: Record<string, ConversationRow> = {};
const fallbackMessages: Record<string, MessageRow[]> = {};

export async function initDB() {
  console.log("[db] initDB called - db:", db, "inMemoryMode:", inMemoryMode);
  if (db) {
    console.log("[db] Database already initialized");
    return;
  }
  if (inMemoryMode) {
    console.log("[db] Using in-memory mode (already set)");
    return;
  }

  // Try to load the Tauri database - if it fails, fall back to memory
  try {
    console.log("[db] Attempting to load SQLite database...");
    db = await Database.load("sqlite:chat.db");
    console.log("[db] SQLite database loaded successfully");

    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        createdAt TEXT,
        updatedAt TEXT
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT,
        role TEXT,
        content TEXT,
        createdAt TEXT
      )
    `);
    console.log("[db] Database initialized successfully");
  } catch (error) {
    console.warn(
      "[db] SQL plugin unavailable (not in Tauri or plugin not ready), falling back to in-memory storage.",
      error,
    );
    console.log(
      "[db] Error details:",
      error instanceof Error ? error.message : String(error),
    );
    inMemoryMode = true;
    db = null;
  }
  console.log(
    "[db] initDB complete - inMemoryMode:",
    inMemoryMode,
    "db:",
    db ? "connected" : "null",
  );
}

// safe getter for db
function getDB() {
  if (!db) throw new Error("DB not initialized. Did you forget initDB()?");
  return db;
}

// actual queries
export async function createConversation(id: string, title: string) {
  const now = new Date().toISOString();
  if (inMemoryMode) {
    fallbackConversations[id] = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
    };
    fallbackMessages[id] = fallbackMessages[id] ?? [];
    return;
  }

  await getDB().execute(
    `INSERT INTO conversations (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
    [id, title, now, now],
  );
}

export async function getConversations(): Promise<ConversationRow[]> {
  if (inMemoryMode) {
    return Object.values(fallbackConversations).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  return await getDB().select<ConversationRow[]>(
    `SELECT * FROM conversations ORDER BY updatedAt DESC`,
  );
}

export async function addMessage(msg: {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}) {
  if (inMemoryMode) {
    const messageList = fallbackMessages[msg.conversationId] ?? [];
    fallbackMessages[msg.conversationId] = [
      ...messageList,
      {
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      },
    ];
    const conversation = fallbackConversations[msg.conversationId];
    if (conversation) {
      conversation.updatedAt = msg.createdAt;
    }
    return;
  }

  await getDB().execute(
    `INSERT INTO messages (id, conversationId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [msg.id, msg.conversationId, msg.role, msg.content, msg.createdAt],
  );

  // also update conversation updatedAt
  await getDB().execute(`UPDATE conversations SET updatedAt = ? WHERE id = ?`, [
    msg.createdAt,
    msg.conversationId,
  ]);
}

export async function getMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  if (inMemoryMode) {
    return [...(fallbackMessages[conversationId] ?? [])];
  }

  return await getDB().select<MessageRow[]>(
    `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`,
    [conversationId],
  );
}

export async function updateConversation(
  id: string,
  updates: { title?: string; updatedAt?: string },
) {
  if (inMemoryMode) {
    const conversation = fallbackConversations[id];
    if (conversation) {
      if (updates.title !== undefined) conversation.title = updates.title;
      if (updates.updatedAt !== undefined)
        conversation.updatedAt = updates.updatedAt;
    }
    return;
  }

  const setClauses: string[] = [];
  const values: (string | undefined)[] = [];

  if (updates.title !== undefined) {
    setClauses.push("title = ?");
    values.push(updates.title);
  }
  if (updates.updatedAt !== undefined) {
    setClauses.push("updatedAt = ?");
    values.push(updates.updatedAt);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await getDB().execute(
    `UPDATE conversations SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

export async function deleteConversation(conversationId: string) {
  if (inMemoryMode) {
    delete fallbackConversations[conversationId];
    delete fallbackMessages[conversationId];
    return;
  }

  await getDB().execute(`DELETE FROM messages WHERE conversationId = ?`, [
    conversationId,
  ]);
  await getDB().execute(`DELETE FROM conversations WHERE id = ?`, [
    conversationId,
  ]);
}
