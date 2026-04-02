export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface StreamPayload {
  content: string;
  done: boolean;
}