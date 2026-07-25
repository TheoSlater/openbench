export type MemoryScope = "user" | "project" | "chat";
export type MemoryCategory =
  | "identity"
  | "preference"
  | "goal"
  | "project"
  | "relationship"
  | "event"
  | "instruction"
  | "other";

export type MemorySettings = {
  ownerId: string;
  enabled: boolean;
  provider: "disabled" | "mem0" | string;
  automaticExtraction: boolean;
  requireSensitiveConfirmation: boolean;
  enableUserMemory: boolean;
  enableProjectMemory: boolean;
  enableChatMemory: boolean;
  allowTemporaryRecall: boolean;
  retrievalLimit: number;
  tokenBudget: number;
  extractionProviderId: number | null;
  extractionProvider: string | null;
  extractionModel: string | null;
  extractionApiBaseUrl: string | null;
  embeddingProviderId: number | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingApiBaseUrl: string | null;
  mem0Endpoint: string | null;
  locality: string;
};

export type MemoryRecord = {
  id: string;
  ownerId: string;
  scope: MemoryScope;
  scopeOwnerId: string;
  category: MemoryCategory;
  canonicalKey: string | null;
  value: unknown;
  summary: string;
  confidence: number;
  importance: number;
  sourceChatId: string | null;
  sourceMessageIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  supersedesId: string | null;
  isActive: boolean;
  deletedAt: string | null;
  syncStatus: string;
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type MemoryListQuery = {
  ownerId: string;
  scope?: MemoryScope | null;
  scopeOwnerId?: string | null;
  category?: MemoryCategory | null;
  includeInactive: boolean;
  includeDeleted: boolean;
  includeSuperseded: boolean;
  limit?: number | null;
  offset?: number | null;
};

export type MemorySearchQuery = {
  ownerId: string;
  query: string;
  scope?: MemoryScope | null;
  scopeOwnerId?: string | null;
  category?: MemoryCategory | null;
  includeInactive: boolean;
  includeDeleted: boolean;
  limit?: number | null;
};

export type MemoryRememberMessageInput = {
  ownerId: string;
  scope: MemoryScope;
  scopeOwnerId: string;
  category: MemoryCategory;
  canonicalKey?: string | null;
  value: unknown;
  summary: string;
  confidence?: number | null;
  importance?: number | null;
  sourceChatId?: string | null;
  sourceMessageIds: string[];
};

export type MemoryProcessingRecord = {
  turnId: string;
  ownerId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  state: "pending" | "processing" | "completed" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type MemoryForgetMessageInput = {
  ownerId: string;
  memoryId?: string | null;
  scope: MemoryScope;
  scopeOwnerId: string;
  canonicalKey?: string | null;
  sourceChatId?: string | null;
  sourceMessageIds: string[];
};
