import type { ModelProvider } from "@/store/modelStore";

export type Role = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  isTemporary?: boolean;
  folderId?: string;
  metadata?: ConversationMetadata;
  titleSource?: "default" | "generated" | "manual";
  titleGeneratedAt?: string;
  titleGenerationStatus?: "idle" | "generating" | "done" | "failed";
}

export interface ConversationMetadata {
  activeFeatureIds?: string[];
  surfaces?: Array<{
    kind: string;
    id: string;
    title?: string;
    url?: string;
    openedAt?: string;
  }>;
}

export interface Attachment {
  id: string;
  name: string;
  type: string; // mime type
  size: number;
  content?: string; // base64 for images, text content for text files
  previewUrl?: string; // object URL for draft preview only
  width?: number;
  height?: number;
  status?: "previewing" | "ready" | "processing" | "error";
  error?: string;
}

export interface SearchResultItem {
  url: string;
  title: string;
  highlights?: string[];
}

export interface WebSearchEvent {
  request_id: string;
  query: string;
  status: "searching" | "complete" | "error";
  results?: SearchResultItem[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
  attachments?: Attachment[];
  model?: string;
  provider?: ModelProvider;
  thinking?: string;
  thinkingDuration?: number;
  isThinking?: boolean;
  isStreaming?: boolean;
  status?: "queued" | "streaming" | "complete" | "error" | "aborted";
  errorMessage?: string;
  webSearch?: WebSearchEvent;
  /** Summaries of memories saved from this turn. In-memory only, not persisted. */
  memoryUpdates?: string[];
}

export interface Message extends ChatMessage {}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  backgroundImage?: string;
  systemPrompt?: string;
  contextFiles?: Attachment[];
  createdAt: string;
  updatedAt: string;
}

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
