import { create } from "zustand";
import { getRepository } from "@/lib/repositories";
import { Message, Conversation, Attachment, WebSearchEvent, ConversationMetadata } from "@/types/chat";
import { getNextQueuedMessage } from "@/lib/chat/queue";
import { destroyAiSandbox } from "@/lib/ai/transport";
import { devLog } from "@/features/debug-overlay/devLog";

async function getRepo() {
  return getRepository();
}

async function destroySandbox(id: string): Promise<void> {
  try {
    await destroyAiSandbox(id);
  } catch (error) {
    devLog("error", "chat-store", "Failed to destroy AI sandbox", error);
  }
}

function mergeMessage(
  messages: Message[],
  activeConversationId: string | null,
  payload: Message,
): Message[] {
  if (payload.conversationId !== activeConversationId) return messages;
  const exists = messages.some((m) => m.id === payload.id);
  if (!exists) return [...messages, payload];
  return messages.map((m) => (m.id === payload.id ? payload : m));
}

export type { Conversation, Message };

/** Draft key for the composer before a conversation row exists. */
export const NEW_CHAT_DRAFT_KEY = "__new__";

export type QueuedMessage = {
  id: string;
  conversationId: string;
  content: string;
  attachments?: Attachment[];
};

type ChatStore = {
  conversations: Conversation[];
  conversationsLoading: boolean;
  activeConversationId: string | null;
  streamingConversationId: string | null;
  messages: Message[];
  streamingMessages: Record<string, Message>;
  hasMoreMessages: boolean;
  // Pending attachments, keyed like `drafts` — they belong to the chat you
  // attached them to, not to the app.
  attachmentsByChat: Record<string, Attachment[]>;
  // Composer text, keyed by conversation id (NEW_CHAT_DRAFT_KEY for the
  // not-yet-created chat). Lives here rather than in ChatInput so it neither
  // follows you into another conversation nor dies when the composer
  // remounts between the empty state and the message list.
  drafts: Record<string, string>;
  // Features (web search, ...) enabled for the conversation on screen.
  // Deliberately NOT persisted: the saved default lives in settings, and
  // opening an old chat must not rewrite it.
  activeFeatureIds: string[];
  messageQueue: QueuedMessage[];
  accountId: string | null;
  deletedConversationIds: string[];
  actions: {
    setDraft: (key: string, value: string) => void;
    clearDraft: (key: string) => void;
    setActiveFeatureIds: (ids: string[]) => void;
    toggleFeature: (id: string) => void;
    setAccountId: (accountId: string | null) => void;
    createConversation: (title?: string, isTemporary?: boolean, folderId?: string) => Promise<Conversation>;
    setActiveConversationId: (id: string | null) => Promise<void>;
    setStreamingConversationId: (id: string | null) => void;
    setMessages: (messages: Message[]) => void;
    setStreamingMessage: (id: string, message: Message | null) => void;
    patchStreamingMessage: (id: string, update: Partial<Message>) => void;
    patchStreamingMessages: (updates: Record<string, Partial<Message>>) => void;
    attachMemoryUpdates: (conversationId: string, userMessageId: string, summaries: string[]) => void;
    loadMoreMessages: () => Promise<void>;
    addMessage: (message: {
      conversationId: string;
      role: "user" | "assistant";
      content: string;
      id?: string;
      createdAt?: string;
      attachments?: Attachment[];
      model?: string;
      provider?: Message["provider"];
      thinking?: string;
      thinkingDuration?: number;
      thinkingTimings?: number[];
      isThinking?: boolean;
      isStreaming?: boolean;
      status?: Message["status"];
      errorMessage?: string;
      webSearch?: WebSearchEvent;
      memoryUpdates?: string[];
      runtimeParts?: Message["runtimeParts"];
      usage?: Message["usage"];
      finishReason?: Message["finishReason"];
      agentSessionId?: string;
    }) => Promise<Message>;
    loadConversations: () => Promise<void>;
    deleteConversation: (id: string) => Promise<void>;
    deleteConversations: (ids: string[]) => Promise<void>;
    deleteAllConversations: () => Promise<void>;
    archiveConversation: (id: string) => Promise<void>;
    unarchiveConversation: (id: string) => Promise<void>;
    renameConversation: (id: string, newTitle: string, titleSource?: "default" | "generated" | "manual") => Promise<void>;
    updateConversationMetadata: (id: string, metadata: ConversationMetadata) => Promise<void>;
    setTitleGenerationStatus: (id: string, status: "idle" | "generating" | "done" | "failed") => void;
    deleteMessagesAfter: (
      conversationId: string,
      messageId: string,
    ) => Promise<void>;
    addAttachment: (key: string, attachment: Attachment) => void;
    updateAttachment: (key: string, id: string, updates: Partial<Attachment>) => void;
    removeAttachment: (key: string, id: string) => void;
    clearAttachments: (key: string) => void;
    enqueueMessage: (msg: QueuedMessage) => void;
    dequeueMessage: (id: string) => void;
    clearQueue: () => void;
    getNextQueued: (conversationId: string) => QueuedMessage | undefined;
    clearFolderAssignments: (folderIds: Set<string>) => void;
  };
};
let switchSeq = 0;

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  activeConversationId: null,
  streamingConversationId: null,
  messages: [],
  streamingMessages: {},
  hasMoreMessages: false,
  attachmentsByChat: {},
  drafts: {},
  activeFeatureIds: [],
  messageQueue: [],
  accountId: null,
  deletedConversationIds: [],
  actions: {
    setDraft: (key, value) =>
      set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
    clearDraft: (key) =>
      set((state) => {
        if (!(key in state.drafts)) return {};
        const { [key]: _removed, ...rest } = state.drafts;
        return { drafts: rest };
      }),
    setActiveFeatureIds: (ids) => set({ activeFeatureIds: [...ids].sort() }),
    toggleFeature: (id) =>
      set((state) => ({
        activeFeatureIds: state.activeFeatureIds.includes(id)
          ? state.activeFeatureIds.filter((featureId) => featureId !== id)
          : [...state.activeFeatureIds, id].sort(),
      })),
    setAccountId: (accountId) => set({ accountId }),
    loadConversations: async () => {
      const userId = get().accountId;
      if (!userId) {
        set({ conversations: [], conversationsLoading: false, messages: [], hasMoreMessages: false, activeConversationId: null });
        return;
      }
      set({ conversationsLoading: true });
      try {
        const r = await getRepo();
        const conversations = await r.getConversations(userId);
        set({ conversations, conversationsLoading: false });
      } catch {
        set({ conversationsLoading: false });
      }
    },
    setStreamingConversationId: (id) => set({ streamingConversationId: id }),
    setStreamingMessage: (id, message) => set((state) => {
      if (message) {
        state.streamingMessages[id] = message;
      } else {
        delete state.streamingMessages[id];
      }
      return { streamingMessages: { ...state.streamingMessages } };
    }),
    patchStreamingMessage: (id, update) => set((state) => {
      const existing = state.streamingMessages[id];
      if (!existing) return state;
      Object.assign(existing, update);
      return { streamingMessages: { ...state.streamingMessages } };
    }),
    patchStreamingMessages: (updates: Record<string, Partial<Message>>) => set((state) => {
      let changed = false;
      for (const [id, update] of Object.entries(updates)) {
        const existing = state.streamingMessages[id];
        if (existing) {
          Object.assign(existing, update);
          changed = true;
        }
      }
      if (!changed) return state;
      return { streamingMessages: { ...state.streamingMessages } };
    }),
    // "Memory updated" chip for extraction that finishes after the stream:
    // stamps the assistant message(s) of the turn already settled into
    // messages, and persists so the chip survives reload.
    attachMemoryUpdates: (conversationId, userMessageId, summaries) => {
      const stamped: string[] = [];
      set((state) => {
        const turnStart = state.messages.findIndex((m) => m.id === userMessageId);
        if (turnStart === -1) return state;
        const messages = state.messages.map((m, i) => {
          if (
            i > turnStart &&
            m.conversationId === conversationId &&
            m.role === "assistant" &&
            !m.memoryUpdates
          ) {
            stamped.push(m.id);
            return { ...m, memoryUpdates: summaries };
          }
          return m;
        });
        return stamped.length ? { messages } : state;
      });
      for (const id of stamped) {
        getRepo()
          .then((r) => r.setMessageMemoryUpdates(id, summaries))
          .catch((error) => devLog("error", "chat-store", "Failed to persist memory updates", error));
      }
    },
    createConversation: async (title = "New Chat", isTemporary = false, folderId) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        isTemporary,
        folderId,
        titleSource: "default",
      };
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: id,
        messages: [],
        hasMoreMessages: false,
      }));
      if (!isTemporary) {
        try {
          const r = await getRepo();
          const userId = get().accountId;
          await r.createConversation(id, title, userId || undefined, folderId);
        } catch (error) {
          devLog("error", "chat-store", "Failed to persist conversation", error);
        }
      }
      return conversation;
    },
    // Set active conversation and load its messages
    setActiveConversationId: async (id) => {
      if (!id) {
        set({ activeConversationId: null, messages: [], hasMoreMessages: false });
        return;
      }

      const seq = ++switchSeq;
      const pageSize = 50;
      try {
        const r = await getRepo();
        const messages = await r.getMessages(id, pageSize, 0);
        if (seq !== switchSeq) return;
        set({
          activeConversationId: id,
          messages,
          hasMoreMessages: messages.length === pageSize,
        });
      } catch (error) {
        devLog("error", "chat-store", "Failed to load conversation messages", error);
        if (seq !== switchSeq) return;
        set({ activeConversationId: id, messages: [], hasMoreMessages: false });
      }
    },
    loadMoreMessages: async () => {
      const { activeConversationId, messages } = useChatStore.getState();
      if (!activeConversationId) return;

      const pageSize = 50;
      const offset = messages.length;
      try {
        const r = await getRepo();
        const newMessages = await r.getMessages(activeConversationId, pageSize, offset);

        if (newMessages.length === 0) {
          set({ hasMoreMessages: false });
          return;
        }
        set({
          messages: [...newMessages, ...messages],
          hasMoreMessages: newMessages.length === pageSize,
        });
      } catch (error) {
        devLog("error", "chat-store", "Failed to load more messages", error);
      }
    },
    setMessages: (messages) => set({ messages }),
    addMessage: async (message) => {
      const now = message.createdAt ?? new Date().toISOString();
      const payload: Message = {
        id: message.id ?? crypto.randomUUID(),
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        createdAt: now,
        attachments: message.attachments,
        model: message.model,
        provider: message.provider,
        thinking: message.thinking,
        thinkingDuration: message.thinkingDuration,
        thinkingTimings: message.thinkingTimings,
        isThinking: message.isThinking,
        isStreaming: message.isStreaming ?? false,
        status: message.status,
        errorMessage: message.errorMessage,
        webSearch: message.webSearch,
        memoryUpdates: message.memoryUpdates,
        runtimeParts: message.runtimeParts,
        usage: message.usage,
        finishReason: message.finishReason,
        agentSessionId: message.agentSessionId,
      };

      const { conversations } = useChatStore.getState();
      const conversation = conversations.find(c => c.id === message.conversationId);
      const isTemporary = conversation?.isTemporary ?? false;

      set((state) => ({
        messages: mergeMessage(state.messages, state.activeConversationId, payload),
        conversations: state.conversations.map((c) =>
          c.id === payload.conversationId
            ? { ...c, updatedAt: payload.createdAt }
            : c,
        ),
      }));

      if (!isTemporary) {
        try {
          const r = await getRepo();
          await r.addMessage(payload);
        } catch (error) {
          devLog("error", "chat-store", "Failed to persist message", error);
        }
      }
      return payload;
    },
    deleteConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        try {
          const r = await getRepo();
          await r.deleteConversation(id);
        } catch (error) {
          devLog("error", "chat-store", "Failed to delete conversation", error);
        }
      }
      await destroySandbox(id);

      set((state) => {
        const newConversations = state.conversations.filter((c) => c.id !== id);
        const wasActive = state.activeConversationId === id;
        const newActiveId = wasActive
          ? (newConversations.find((c) => !c.isArchived)?.id ?? null)
          : state.activeConversationId;
        const newMessages = wasActive ? [] : state.messages;

        return {
          conversations: newConversations,
          activeConversationId: newActiveId,
          messages: newMessages,
          deletedConversationIds: [id],
        };
      });
    },
    deleteConversations: async (ids) => {
      const { conversations } = useChatStore.getState();
      const toDelete = ids.filter((id) => {
        const conv = conversations.find((c) => c.id === id);
        return conv && !conv.isTemporary;
      });

      if (toDelete.length > 0) {
        try {
          const r = await getRepo();
          await r.deleteConversations(toDelete);
        } catch (error) {
          devLog("error", "chat-store", "Failed to delete conversations", error);
        }
      }
      await Promise.all(ids.map(destroySandbox));

      set((state) => {
        const newConversations = state.conversations.filter((c) => !ids.includes(c.id));
        const wasActive = ids.includes(state.activeConversationId ?? "");
        const newActiveId = wasActive
          ? (newConversations.find((c) => !c.isArchived)?.id ?? null)
          : state.activeConversationId;
        return {
          conversations: newConversations,
          activeConversationId: newActiveId,
          messages: wasActive ? [] : state.messages,
          deletedConversationIds: ids,
        };
      });
    },
    deleteAllConversations: async () => {
      const userId = get().accountId;
      if (!userId) return;

      const { conversations } = useChatStore.getState();
      const userConversations = conversations.filter(
        (c) => !c.isTemporary,
      );

      if (userConversations.length > 0) {
        try {
          const r = await getRepo();
          await r.deleteAllConversations(userId);
        } catch (error) {
          devLog("error", "chat-store", "Failed to delete all conversations", error);
        }
      }
      await Promise.all(conversations.map((conversation) => destroySandbox(conversation.id)));

      set({
        conversations: [],
        activeConversationId: null,
        messages: [],
        deletedConversationIds: userConversations.map((conversation) => conversation.id),
      });
    },
    archiveConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        try {
          const r = await getRepo();
          await r.updateConversation(id, { isArchived: true });
        } catch (error) {
          devLog("error", "chat-store", "Failed to archive conversation", error);
        }
      }

      set((state) => {
        const newConversations = state.conversations.map((c) =>
          c.id === id ? { ...c, isArchived: true } : c,
        );
        const wasActive = state.activeConversationId === id;
        const newActiveId = wasActive
          ? (newConversations.find((c) => !c.isArchived)?.id ?? null)
          : state.activeConversationId;
        const newMessages = wasActive ? [] : state.messages;

        return {
          conversations: newConversations,
          activeConversationId: newActiveId,
          messages: newMessages,
        };
      });
    },
    unarchiveConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        try {
          const r = await getRepo();
          await r.updateConversation(id, { isArchived: false });
        } catch (error) {
          devLog("error", "chat-store", "Failed to unarchive conversation", error);
        }
      }

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, isArchived: false } : c,
        ),
      }));
    },
    renameConversation: async (id, newTitle, titleSource) => {
      const now = new Date().toISOString();
      const conversation = useChatStore.getState().conversations.find((c) => c.id === id);

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? {
            ...c,
            title: newTitle,
            updatedAt: now,
            titleSource: titleSource ?? c.titleSource,
            titleGeneratedAt: titleSource === "generated" ? now : c.titleGeneratedAt,
          } : c,
        ),
      }));

      if (conversation && !conversation.isTemporary) {
        try {
          const r = await getRepo();
          await r.updateConversation(id, { title: newTitle, updatedAt: now });
        } catch (e) {
          devLog("warn", "chat-store", "Failed to persist renamed title", e);
        }
      }
    },
    updateConversationMetadata: async (id, metadata) => {
      const conversation = useChatStore.getState().conversations.find((c) => c.id === id);
      if (!conversation) return;
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, metadata } : c,
        ),
      }));
      if (conversation.isTemporary) return;
      try {
        const r = await getRepo();
        await r.updateConversation(id, { metadata });
      } catch (error) {
        devLog("error", "chat-store", "Failed to update conversation metadata", error);
      }
    },
    setTitleGenerationStatus: (id, status) => set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, titleGenerationStatus: status } : c,
      ),
    })),
    // Delete messages after a specific message ID (inclusive)
    deleteMessagesAfter: async (conversationId, messageId) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === conversationId);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        try {
          const r = await getRepo();
          await r.deleteMessagesAfter(conversationId, messageId);
        } catch (error) {
          devLog("error", "chat-store", "Failed to delete messages after", error);
        }
      }

      set((state) => {
        const index = state.messages.findIndex((m) => m.id === messageId);
        if (index === -1) return state;
        return { messages: state.messages.slice(0, index) };
      });
    },
    enqueueMessage: (msg) =>
      set((state) => ({
        messageQueue: [...state.messageQueue, msg],
      })),
    dequeueMessage: (id) =>
      set((state) => ({
        messageQueue: state.messageQueue.filter((m) => m.id !== id),
      })),
    // Stop kills the whole session, so no queued message anywhere should fire later
    clearQueue: () => set({ messageQueue: [] }),
    getNextQueued: (conversationId) => {
      return getNextQueuedMessage(get().messageQueue, conversationId);
    },
    clearFolderAssignments: (folderIds) =>
      set((state) => ({
        conversations: state.conversations.map((chat) =>
          chat.folderId && folderIds.has(chat.folderId)
            ? { ...chat, folderId: undefined }
            : chat,
        ),
      })),
    addAttachment: (key, attachment) =>
      set((state) => ({
        attachmentsByChat: {
          ...state.attachmentsByChat,
          [key]: [...(state.attachmentsByChat[key] ?? []), attachment],
        },
      })),
    updateAttachment: (key, id, updates) =>
      set((state) => ({
        attachmentsByChat: {
          ...state.attachmentsByChat,
          [key]: (state.attachmentsByChat[key] ?? []).map((attachment) =>
            attachment.id === id ? { ...attachment, ...updates } : attachment,
          ),
        },
      })),
    removeAttachment: (key, id) =>
      set((state) => ({
        attachmentsByChat: {
          ...state.attachmentsByChat,
          [key]: (state.attachmentsByChat[key] ?? []).filter((a) => a.id !== id),
        },
      })),
    clearAttachments: (key) =>
      set((state) => {
        if (!(key in state.attachmentsByChat)) return {};
        const { [key]: _removed, ...rest } = state.attachmentsByChat;
        return { attachmentsByChat: rest };
      }),
  },
}));
