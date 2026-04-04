import { create } from "zustand";
import * as db from "@/lib/db";
export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
type ChatStore = {
  conversations: Conversation[];
  activeConversationId: string | null;
  streamingConversationId: string | null;
  messages: Message[];
  actions: {
    createConversation: (title?: string) => Promise<Conversation>;
    setActiveConversationId: (id: string | null) => Promise<void>;
    setStreamingConversationId: (id: string | null) => void;
    setMessages: (messages: Message[]) => void;
    addMessage: (message: {
      conversationId: string;
      role: "user" | "assistant";
      content: string;
      id?: string;
      createdAt?: string;
    }) => Promise<Message>;
    loadConversations: () => Promise<void>;
    deleteConversation: (id: string) => Promise<void>;
    renameConversation: (id: string, newTitle: string) => Promise<void>;
    deleteMessagesAfter: (
      conversationId: string,
      messageId: string,
    ) => Promise<void>;
  };
};
export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  activeConversationId: null,
  streamingConversationId: null,
  messages: [],
  actions: {
    // Load all conversations from DB
    loadConversations: async () => {
      const rawConversations = await db.getConversations();
      const conversations: Conversation[] = rawConversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
      set({ conversations });
    },
    setStreamingConversationId: (id) => set({ streamingConversationId: id }),
    // Create a new conversation
    createConversation: async (title = "New Chat") => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.createConversation(id, title);
      const conversation: Conversation = {
        id,
        title,
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: id,
        messages: [],
      }));
      return conversation;
    },
    // Set active conversation and load its messages
    setActiveConversationId: async (id) => {
      set({ activeConversationId: id });
      if (id) {
        const rawMessages = await db.getMessages(id);
        const messages: Message[] = rawMessages.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        set({ messages });
      } else {
        set({ messages: [] });
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
      };
      await db.addMessage(payload);
      set((state) => ({
        messages: [...state.messages, payload],
      }));
      return payload;
    },
    // Delete a conversation and its messages
    deleteConversation: async (id) => {
      await db.deleteConversation(id);
      set((state) => {
        const newConversations = state.conversations.filter((c) => c.id !== id);
        const newActiveId =
          state.activeConversationId === id
            ? (newConversations[0]?.id ?? null)
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
    // Rename a conversation
    renameConversation: async (id, newTitle) => {
      const now = new Date().toISOString();
      await db.updateConversation(id, { title: newTitle, updatedAt: now });
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, title: newTitle, updatedAt: now } : c,
        ),
      }));
    },
    // Delete messages after a specific message ID (inclusive)
    deleteMessagesAfter: async (conversationId, messageId) => {
      await db.deleteMessagesAfter(conversationId, messageId);
      set((state) => {
        const index = state.messages.findIndex((m) => m.id === messageId);
        if (index === -1) return state;
        return {
          messages: state.messages.slice(0, index),
        };
      });
    },
  },
}));
