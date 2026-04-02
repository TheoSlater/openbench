import { create } from "zustand";

export type ModelProvider = "ollama" | "anthropic" | "openai";

export type AvailableModels = {
  ollama: string[];
  anthropic: string[];
  openai: string[];
};

export type SystemPrompt = {
  id: string;
  name: string;
  content: string;
  baseStyle?: string;
  characteristics?: string[];
  instantAnswers?: boolean;
};

type ModelStore = {
  selectedModel: string;
  selectedProvider: ModelProvider;
  availableModels: AvailableModels;
  isLoading: boolean;
  ollamaError: string | null;
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
  setSelectedModel: (provider: ModelProvider, model: string) => void;
  setAvailableModels: (models: Partial<AvailableModels>) => void;
  setIsLoading: (isLoading: boolean) => void;
  setOllamaError: (error: string | null) => void;
  actions: {
    /**
     * Set the active system prompt by id.
     * @param id - The prompt id to activate, or null to clear.
     */
    setSystemPrompt: (id: string | null) => void;
    /**
     * Add a new system prompt to the list.
     * @param prompt - The full prompt object to add.
     */
    addSystemPrompt: (prompt: SystemPrompt) => void;
    /**
     * Delete a system prompt by id.
     * @param id - The prompt id to remove.
     */
    deleteSystemPrompt: (id: string) => void;
    /**
     * Update an existing system prompt.
     * @param prompt - The prompt object with updated fields.
     */
    updateSystemPrompt: (prompt: SystemPrompt) => void;
    /**
     * Clear all system prompts and reset to default.
     */
    resetSystemPrompts: () => void;
  };
};

const defaultAvailableModels: AvailableModels = {
  ollama: [],
  anthropic: [],
  openai: [],
};

const defaultSystemPrompt: SystemPrompt = {
  id: "default",
  name: "Default",
  content:
    "You are a helpful assistant. Be concise, direct, and clear. Ask a clarifying question when requirements are ambiguous.",
};

export const useModelStore = create<ModelStore>((set) => ({
  selectedModel: "",
  selectedProvider: "ollama",
  availableModels: defaultAvailableModels,
  isLoading: false,
  ollamaError: null,
  systemPrompts: [defaultSystemPrompt],
  activeSystemPromptId: defaultSystemPrompt.id,
  setSelectedModel: (provider, model) =>
    set({ selectedProvider: provider, selectedModel: model }),
  setAvailableModels: (models) =>
    set((state) => ({
      availableModels: { ...state.availableModels, ...models },
    })),
  setIsLoading: (isLoading) => set({ isLoading }),
  setOllamaError: (error) => set({ ollamaError: error }),
  actions: {
    setSystemPrompt: (id) => set({ activeSystemPromptId: id }),
    addSystemPrompt: (prompt) =>
      set((state) => ({
        systemPrompts: [...state.systemPrompts, prompt],
      })),
    deleteSystemPrompt: (id) =>
      set((state) => {
        const nextPrompts = state.systemPrompts.filter(
          (prompt) => prompt.id !== id,
        );
        const nextActive =
          state.activeSystemPromptId === id
            ? nextPrompts[0]?.id ?? null
            : state.activeSystemPromptId;
        return {
          systemPrompts: nextPrompts,
          activeSystemPromptId: nextActive,
        };
      }),
    updateSystemPrompt: (prompt) =>
        set((state) => ({
        systemPrompts: state.systemPrompts.map((item) =>
          item.id === prompt.id ? prompt : item,
        ),
      })),
    resetSystemPrompts: () =>
      set({
        systemPrompts: [defaultSystemPrompt],
        activeSystemPromptId: defaultSystemPrompt.id,
      }),
  },
}));

export const providerLabels: Record<ModelProvider, string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
};
