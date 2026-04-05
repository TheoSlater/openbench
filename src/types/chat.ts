export type Role = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  type: string; // mime type
  size: number;
  content?: string; // base64 for images, text content for text files
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
  attachments?: Attachment[];
}

export interface Message extends ChatMessage {}

export interface StreamPayload {
  content: string;
  done: boolean;
}