export type Role = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  isTemporary?: boolean;
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
  model?: string;
  thinking?: string;
  thinkingDuration?: number;
  isThinking?: boolean;
}

export interface Message extends ChatMessage {}

export interface StreamPayload {
  request_id: string;
  content: string;
  done: boolean;
  metadata?: {
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_duration?: number;
    eval_duration?: number;
  };
}