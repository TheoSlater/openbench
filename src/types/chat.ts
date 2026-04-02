export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface StreamPayload {
  content: string;
  done: boolean;
}