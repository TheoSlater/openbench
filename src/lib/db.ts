import Database from "@tauri-apps/plugin-sql";

export type ConversationRow = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isArchived: number; // 0 or 1
};

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  fullName?: string;
  status: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRow = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: string; // JSON string
  model?: string;
  thinking?: string;
  thinkingDuration?: number;
};

let db: Database | null = null;
let isInMemoryMode = false;

console.log("[db] Environment check:", {
  hasWindow: typeof window !== "undefined",
  userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
});
const fallbackConversations: Record<string, ConversationRow> = {};
const fallbackMessages: Record<string, MessageRow[]> = {};
const fallbackUsers: Record<string, UserRow> = {};
const fallbackSessions: Record<string, SessionRow> = {};

async function setupSchema(database: Database) {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      isArchived INTEGER DEFAULT 0
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT,
      role TEXT,
      content TEXT,
      createdAt TEXT,
      attachments TEXT,
      model TEXT,
      thinking TEXT
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      fullName TEXT,
      status TEXT DEFAULT 'Active',
      avatarUrl TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT,
      token TEXT UNIQUE NOT NULL,
      expiresAt TEXT,
      createdAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id)
    )
  `);
}

async function runMigrations(database: Database) {
  try {
    const columns = await database.select<{ name: string }[]>(
      "PRAGMA table_info(messages)",
    );
    const hasColumn = (name: string) => columns.some((col) => col.name === name);

    if (!hasColumn("model")) {
      await database.execute("ALTER TABLE messages ADD COLUMN model TEXT");
    }
    if (!hasColumn("thinking")) {
      await database.execute("ALTER TABLE messages ADD COLUMN thinking TEXT");
    }
    if (!hasColumn("thinkingDuration")) {
      await database.execute("ALTER TABLE messages ADD COLUMN thinkingDuration REAL");
    }
  } catch (err) {
    console.error("[db] Error checking/adding columns:", err);
  }

  try {
    await database.execute(`ALTER TABLE messages ADD COLUMN attachments TEXT`);
    console.log("[db] Migration: Added attachments column to messages table");
  } catch {
    console.log("[db] Migration: attachments column already exists");
  }

  try {
    await database.execute(`ALTER TABLE conversations ADD COLUMN isArchived INTEGER DEFAULT 0`);
    console.log("[db] Migration: Added isArchived column to conversations table");
  } catch {
    console.log("[db] Migration: isArchived column already exists");
  }
}

export async function initDB() {
  console.log("[db] initDB called - db:", db, "isInMemoryMode:", isInMemoryMode);

  if (db) {
    console.log("[db] Database already initialized");
    return;
  }

  if (isInMemoryMode) {
    console.log("[db] Using in-memory mode (already set)");
    return;
  }

  try {
    console.log("[db] Attempting to load SQLite database...");
    db = await Database.load("sqlite:chat.db");
    console.log("[db] SQLite database loaded successfully");

    await setupSchema(db);
    await runMigrations(db);

    console.log("[db] Database initialized successfully");
  } catch (error) {
    console.warn("[db] SQL plugin unavailable, falling back to in-memory storage.", error);
    console.log("[db] Error details:", error instanceof Error ? error.message : String(error));
    isInMemoryMode = true;
    db = null;
  }

  console.log("[db] initDB complete - isInMemoryMode:", isInMemoryMode, "db:", db ? "connected" : "null");
}

// safe getter for db
function getDB() {
  if (!db) throw new Error("DB not initialized. Did you forget initDB()?");
  return db;
}

export async function createConversation(id: string, title: string) {
  const now = new Date().toISOString();

  if (isInMemoryMode) {
    fallbackConversations[id] = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      isArchived: 0,
    };
    fallbackMessages[id] = fallbackMessages[id] ?? [];
    return;
  }

  await getDB().execute(
    `INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived) VALUES (?, ?, ?, ?, 0)`,
    [id, title, now, now],
  );
}

export async function getConversations(): Promise<ConversationRow[]> {
  if (isInMemoryMode) {
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
  attachments?: any[];
  model?: string;
  thinking?: string;
  thinkingDuration?: number;
}) {
  if (isInMemoryMode) {
    const messageList = fallbackMessages[msg.conversationId] ?? [];
    fallbackMessages[msg.conversationId] = [
      ...messageList,
      {
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        attachments: msg.attachments ? JSON.stringify(msg.attachments) : undefined,
        model: msg.model,
        thinking: msg.thinking,
        thinkingDuration: msg.thinkingDuration,
      },
    ];

    const conversation = fallbackConversations[msg.conversationId];
    if (conversation) {
      conversation.updatedAt = msg.createdAt;
    }
    return;
  }

  await getDB().execute(
    `INSERT INTO messages (id, conversationId, role, content, createdAt, attachments, model, thinking, thinkingDuration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.conversationId,
      msg.role,
      msg.content,
      msg.createdAt,
      msg.attachments ? JSON.stringify(msg.attachments) : null,
      msg.model || null,
      msg.thinking || null,
      msg.thinkingDuration || null,
    ],
  );

  await getDB().execute(
    `UPDATE conversations SET updatedAt = ? WHERE id = ?`,
    [msg.createdAt, msg.conversationId],
  );
}

export async function getMessages(
  conversationId: string,
  limit?: number,
  offset?: number,
): Promise<MessageRow[]> {
  if (isInMemoryMode) {
    const all = [...(fallbackMessages[conversationId] ?? [])];

    if (limit === undefined || offset === undefined) {
      return all;
    }

    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const paged = all.slice(offset, offset + limit);
    return paged.reverse();
  }

  if (limit !== undefined && offset !== undefined) {
    const results = await getDB().select<MessageRow[]>(
      `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      [conversationId, limit, offset],
    );
    return results.reverse();
  }

  return await getDB().select<MessageRow[]>(
    `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`,
    [conversationId],
  );
}

export async function updateConversation(
  id: string,
  updates: { title?: string; updatedAt?: string; isArchived?: boolean },
) {
  if (isInMemoryMode) {
    const conversation = fallbackConversations[id];
    if (conversation) {
      if (updates.title !== undefined) conversation.title = updates.title;
      if (updates.updatedAt !== undefined) conversation.updatedAt = updates.updatedAt;
      if (updates.isArchived !== undefined) {
        conversation.isArchived = updates.isArchived ? 1 : 0;
      }
    }
    return;
  }

  const setClauses: string[] = [];
  const values: (string | number | null | undefined)[] = [];

  if (updates.title !== undefined) {
    setClauses.push("title = ?");
    values.push(updates.title);
  }
  if (updates.updatedAt !== undefined) {
    setClauses.push("updatedAt = ?");
    values.push(updates.updatedAt);
  }
  if (updates.isArchived !== undefined) {
    setClauses.push("isArchived = ?");
    values.push(updates.isArchived ? 1 : 0);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  await getDB().execute(
    `UPDATE conversations SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

export async function deleteConversation(conversationId: string) {
  if (isInMemoryMode) {
    delete fallbackConversations[conversationId];
    delete fallbackMessages[conversationId];
    return;
  }

  await getDB().execute(`DELETE FROM messages WHERE conversationId = ?`, [conversationId]);
  await getDB().execute(`DELETE FROM conversations WHERE id = ?`, [conversationId]);
}

export async function deleteMessagesAfter(
  conversationId: string,
  messageId: string,
) {
  if (isInMemoryMode) {
    const messages = fallbackMessages[conversationId] ?? [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index !== -1) {
      fallbackMessages[conversationId] = messages.slice(0, index);
    }
    return;
  }

  const targetMessage = await getDB().select<MessageRow[]>(
    `SELECT createdAt FROM messages WHERE id = ?`,
    [messageId],
  );

  if (targetMessage.length === 0) return;

  await getDB().execute(
    `DELETE FROM messages WHERE conversationId = ? AND createdAt >= ?`,
    [conversationId, targetMessage[0].createdAt],
  );
}

// --- Auth Functions ---

export async function createUser(user: Omit<UserRow, "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();

  if (isInMemoryMode) {
    fallbackUsers[user.id] = { ...user, createdAt: now, updatedAt: now };
    return;
  }

  await getDB().execute(
    `INSERT INTO users (id, email, passwordHash, fullName, status, avatarUrl, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.email, user.passwordHash, user.fullName, user.status, user.avatarUrl, now, now],
  );
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  if (isInMemoryMode) {
    return Object.values(fallbackUsers).find((u) => u.email === email) ?? null;
  }

  const results = await getDB().select<UserRow[]>(
    `SELECT * FROM users WHERE email = ?`,
    [email],
  );
  return results[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  if (isInMemoryMode) {
    return fallbackUsers[id] ?? null;
  }

  const results = await getDB().select<UserRow[]>(
    `SELECT * FROM users WHERE id = ?`,
    [id],
  );
  return results[0] ?? null;
}

export async function createSession(session: Omit<SessionRow, "createdAt">) {
  const now = new Date().toISOString();

  if (isInMemoryMode) {
    fallbackSessions[session.id] = { ...session, createdAt: now };
    return;
  }

  await getDB().execute(
    `INSERT INTO sessions (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [session.id, session.userId, session.token, session.expiresAt, now],
  );
}

export async function getSessionByToken(token: string): Promise<SessionRow | null> {
  if (isInMemoryMode) {
    return Object.values(fallbackSessions).find((s) => s.token === token) ?? null;
  }

  const results = await getDB().select<SessionRow[]>(
    `SELECT * FROM sessions WHERE token = ?`,
    [token],
  );
  return results[0] ?? null;
}

export async function deleteSession(token: string) {
  if (isInMemoryMode) {
    const session = Object.values(fallbackSessions).find((s) => s.token === token);
    if (session) {
      delete fallbackSessions[session.id];
    }
    return;
  }

  await getDB().execute(`DELETE FROM sessions WHERE token = ?`, [token]);
}

export async function updateUserStatus(userId: string, status: string) {
  const now = new Date().toISOString();

  if (isInMemoryMode) {
    const user = fallbackUsers[userId];
    if (user) {
      user.status = status;
      user.updatedAt = now;
    }
    return;
  }

  await getDB().execute(
    `UPDATE users SET status = ?, updatedAt = ? WHERE id = ?`,
    [status, now, userId],
  );
}
