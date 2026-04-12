import { create } from "zustand";
import * as db from "@/lib/db";
import { Message, Conversation, Attachment } from "@/types/chat";

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
        isArchived: !!c.isArchived,
      }));
      set({ conversations });
    },
    setStreamingConversationId: (id) => set({ streamingConversationId: id }),
    // Create a new conversation
    createConversation: async (title = "New Chat", isTemporary = false) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      if (!isTemporary) {
        await db.createConversation(id, title);
      }
      const conversation: Conversation = {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        isTemporary,
      };
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: id,
        messages: [],
        hasMoreMessages: false,
      }));
      return conversation;
    },
    // Set active conversation and load its messages
    setActiveConversationId: async (id) => {
      set({ activeConversationId: id });
      if (id) {
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
        }));
        set({ messages, hasMoreMessages: messages.length === pageSize });
      } else {
        set({ messages: [], hasMoreMessages: false });
      }
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

      if (rawMessages.length > 0) {
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
        }));
        set({
          messages: [...newMessages, ...messages],
          hasMoreMessages: newMessages.length === pageSize,
        });
      } else {
        set({ hasMoreMessages: false });
      }
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

      if (!isTemporary) {
        await db.addMessage(payload);
      }

      set((state) => ({
        messages: [...state.messages, payload],
      }));
      return payload;
    },
    // Delete a conversation and its messages
    deleteConversation: async (id) => {
      const { conversations } = useChatStore.getState();
      const conversation = conversations.find(c => c.id === id);
      if (conversation && !conversation.isTemporary) {
        await db.deleteConversation(id);
      }
      set((state) => {
        const newConversations = state.conversations.filter((c) => c.id !== id);
        const newActiveId =
          state.activeConversationId === id
            ? (newConversations.find(c => !c.isArchived)?.id ?? null)
            : state.activeConversationId;
        const newMessages =
          state.activeConversationId === id ? [] : state.messages;
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
      const conversation = conversations.find(c => c.id === id);
      if (conversation && !conversation.isTemporary) {
        await db.updateConversation(id, { isArchived: true });
      }
      set((state) => {
        const newConversations = state.conversations.map((c) =>
          c.id === id ? { ...c, isArchived: true } : c,
        );
        const newActiveId =
          state.activeConversationId === id
            ? (newConversations.find(c => !c.isArchived)?.id ?? null)
            : state.activeConversationId;
        const newMessages =
          state.activeConversationId === id ? [] : state.messages;
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
      const conversation = conversations.find(c => c.id === id);
      if (conversation && !conversation.isTemporary) {
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
      const conversation = useChatStore.getState().conversations.find(c => c.id === id);
      if (conversation && !conversation.isTemporary) {
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
      const conversation = conversations.find(c => c.id === conversationId);
      if (conversation && !conversation.isTemporary) {
        await db.deleteMessagesAfter(conversationId, messageId);
      }
      set((state) => {
        const index = state.messages.findIndex((m) => m.id === messageId);
        if (index === -1) return state;
        return {
          messages: state.messages.slice(0, index),
        };
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
