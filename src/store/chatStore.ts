import { create } from "zustand";

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
  messages: Message[];
  actions: {
    createConversation: (title?: string) => Conversation;
    setActiveConversationId: (id: string | null) => void;
    setMessages: (messages: Message[]) => void;
    addMessage: (message: {
      conversationId: string;
      role: "user" | "assistant";
      content: string;
      id?: string;
      createdAt?: string;
    }) => Message;
  };
};

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],

  actions: {
    createConversation: (title = "New Chat") => {
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title,
        createdAt: now,
        updatedAt: now,
      };

      set((state) => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: conversation.id,
        messages: [],
      }));

      return conversation;
    },

    setActiveConversationId: (id) => {
      set({ activeConversationId: id });
      if (id) {
        const conversation = get().conversations.find((c) => c.id === id);
        if (conversation) {
          // Set empty messages for now since we don't persist
          set({ messages: [] });
        }
      }
    },

    setMessages: (messages) => set({ messages }),

    addMessage: (message) => {
      const now = message.createdAt ?? new Date().toISOString();
      const payload: Message = {
        id: message.id ?? crypto.randomUUID(),
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        createdAt: now,
      };

      set((state) => ({
        messages: [...state.messages, payload],
      }));

      return payload;
    },
  },
}));