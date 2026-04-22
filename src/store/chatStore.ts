import { create } from "zustand";
import * as db from "@/lib/db";
import { Message, Conversation, Attachment } from "@/types/chat";
import { startTransition } from "react";

// Perf stub
function perfLog(..._args: unknown[]): void {}

export type { Conversation, Message };

type ChatStore = {
  conversations: Conversation[];
  activeConversationId: string | null;
  streamingConversationId: string | null;
  messages: Message[];
  hasMoreMessages: boolean;
  currentAttachments: Attachment[];
  actions: {
    createConversation: (title?: string, isTemporary?: boolean) => Promise<Conversation>;
    setActiveConversationId: (id: string | null) => Promise<void>;
    setStreamingConversationId: (id: string | null) => void;
    setMessages: (messages: Message[]) => void;
    loadMoreMessages: () => Promise<void>;
    addMessage: (message: {
      conversationId: string;
      role: "user" | "assistant";
      content: string;
      id?: string;
      createdAt?: string;
      attachments?: Attachment[];
      model?: string;
      thinking?: string;
      thinkingDuration?: number;
      isThinking?: boolean;
    }) => Promise<Message>;
    loadConversations: () => Promise<void>;
    deleteConversation: (id: string) => Promise<void>;
    archiveConversation: (id: string) => Promise<void>;
    unarchiveConversation: (id: string) => Promise<void>;
    renameConversation: (id: string, newTitle: string) => Promise<void>;
    deleteMessagesAfter: (
      conversationId: string,
      messageId: string,
    ) => Promise<void>;
    addCurrentAttachment: (attachment: Attachment) => void;
    removeCurrentAttachment: (id: string) => void;
    clearCurrentAttachments: () => void;
  };
};
export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  activeConversationId: null,
  streamingConversationId: null,
  messages: [],
  hasMoreMessages: false,
  currentAttachments: [],
  actions: {
    // Load all conversations from DB
    loadConversations: async () => {
      const rawConversations = await db.getConversations();
      const conversations: Conversation[] = rawConversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        isArchived: Boolean(c.isArchived),
      }));
      set({ conversations });
    },
    setStreamingConversationId: (id) => set({ streamingConversationId: id }),
    // Create a new conversation
    createConversation: async (title = "New Chat", isTemporary = false) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        isTemporary,
      };
      startTransition(() => {
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
          messages: [],
          hasMoreMessages: false,
        }));
      });
      perfLog("store", "chatStore.createConversation.optimistic", {
        id,
        isTemporary,
      });
      if (!isTemporary) {
        try {
          await db.createConversation(id, title);
        } catch (error) {
          console.error("Failed to persist conversation:", error);
        }
      }
      return conversation;
    },
    // Set active conversation and load its messages
    setActiveConversationId: async (id) => {
      set({ activeConversationId: id });

      if (!id) {
        set({ messages: [], hasMoreMessages: false });
        return;
      }

      const pageSize = 50;
      const rawMessages = await db.getMessages(id, pageSize, 0);
      const messages: Message[] = rawMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
        model: m.model,
        thinking: m.thinking,
        thinkingDuration: m.thinkingDuration,
        isThinking: false,
      }));
      startTransition(() => {
        set({ messages, hasMoreMessages: messages.length === pageSize });
      });
    },
    // Load more messages for the active conversation
    loadMoreMessages: async () => {
      const { activeConversationId, messages } = useChatStore.getState();
      if (!activeConversationId) return;

      const pageSize = 50;
      const offset = messages.length;
      const rawMessages = await db.getMessages(
        activeConversationId,
        pageSize,
        offset,
      );

      if (rawMessages.length === 0) {
        set({ hasMoreMessages: false });
        return;
      }

      const newMessages: Message[] = rawMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
        model: m.model,
        thinking: m.thinking,
        thinkingDuration: m.thinkingDuration,
        isThinking: false,
      }));
      set({
        messages: [...newMessages, ...messages],
        hasMoreMessages: newMessages.length === pageSize,
      });
    },
    // Replace current messages in state (sync)
    setMessages: (messages) => set({ messages }),
    // Add a new message to the DB and state
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
        thinking: message.thinking,
        thinkingDuration: message.thinkingDuration,
        isThinking: message.isThinking,
      };

      const { conversations } = useChatStore.getState();
      const conversation = conversations.find(c => c.id === message.conversationId);
      const isTemporary = conversation?.isTemporary ?? true; // Default to true if not found (new unsaved chat)

      set((state) => ({
        messages: [...state.messages, payload],
        conversations: state.conversations.map((c) =>
          c.id === payload.conversationId
            ? { ...c, updatedAt: payload.createdAt }
            : c,
        ),
      }));
      perfLog("store", "chatStore.addMessage.optimistic", {
        conversationId: payload.conversationId,
        role: payload.role,
        hasAttachments: (payload.attachments?.length ?? 0) > 0,
        contentLength: payload.content.length,
      });
      if (!isTemporary) {
        try {
          await db.addMessage(payload);
        } catch (error) {
          console.error("Failed to persist message:", error);
        }
      }
      return payload;
    },
    // Delete a conversation and its messages
    deleteConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        await db.deleteConversation(id);
      }

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
        };
      });
    },
    // Archive a conversation
    archiveConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        await db.updateConversation(id, { isArchived: true });
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
    // Unarchive a conversation
    unarchiveConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        await db.updateConversation(id, { isArchived: false });
      }

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, isArchived: false } : c,
        ),
      }));
    },
    // Rename a conversation
    renameConversation: async (id, newTitle) => {
      const now = new Date().toISOString();
      const conversation = useChatStore.getState().conversations.find((c) => c.id === id);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        await db.updateConversation(id, { title: newTitle, updatedAt: now });
      }

      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, title: newTitle, updatedAt: now } : c,
        ),
      }));
    },
    // Delete messages after a specific message ID (inclusive)
    deleteMessagesAfter: async (conversationId, messageId) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find((c) => c.id === conversationId);
      const shouldPersist = conversation && !conversation.isTemporary;

      if (shouldPersist) {
        await db.deleteMessagesAfter(conversationId, messageId);
      }

      set((state) => {
        const index = state.messages.findIndex((m) => m.id === messageId);
        if (index === -1) return state;
        return { messages: state.messages.slice(0, index) };
      });
    },
    addCurrentAttachment: (attachment) =>
      set((state) => ({
        currentAttachments: [...state.currentAttachments, attachment],
      })),
    removeCurrentAttachment: (id) =>
      set((state) => ({
        currentAttachments: state.currentAttachments.filter((a) => a.id !== id),
      })),
    clearCurrentAttachments: () => set({ currentAttachments: [] }),
  },
}));
