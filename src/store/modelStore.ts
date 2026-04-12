import { create } from "zustand";

export type ModelProvider = "ollama" | "anthropic" | "openai";

export type OllamaModel = {
  name: string;
  families: string[];
  supports_vision: boolean;
  size: number;
};

export type AvailableModels = {
  ollama: OllamaModel[];
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

export type PullProgress = {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
};

type ModelStore = {
  selectedModel: string;
  selectedModels: string[];
  selectedProvider: ModelProvider;
  selectedProviders: ModelProvider[];
  availableModels: AvailableModels;
  isLoading: boolean;
  ollamaError: string | null;
  defaultModel: string;
  pullingModel: string | null;
  pullProgress: PullProgress | null;
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
  setSelectedModel: (provider: ModelProvider, model: string) => void;
  setSelectedModels: (
    models: { provider: ModelProvider; model: string }[],
  ) => void;
  addSelectedModel: (provider: ModelProvider, model: string) => void;
  removeSelectedModel: (index: number) => void;
  updateSelectedModel: (
    index: number,
    provider: ModelProvider,
    model: string,
  ) => void;
  setAvailableModels: (models: Partial<AvailableModels>) => void;
  setIsLoading: (isLoading: boolean) => void;
  setOllamaError: (error: string | null) => void;
  setPullingModel: (model: string | null) => void;
  setPullProgress: (progress: PullProgress | null) => void;
  actions: {
    setDefaultModel: (model: string) => void;
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
  content: "",
};

export const useModelStore = create<ModelStore>((set) => ({
  selectedModel: "",
  selectedModels: [],
  selectedProvider: "ollama",
  selectedProviders: [],
  availableModels: defaultAvailableModels,
  isLoading: false,
  ollamaError: null,
  pullingModel: null,
  pullProgress: null,
  systemPrompts: [defaultSystemPrompt],
  activeSystemPromptId: defaultSystemPrompt.id,
  defaultModel: localStorage.getItem("default_model") || "",
  setSelectedModel: (provider: ModelProvider, model: string) =>
    set({
      selectedProvider: provider,
      selectedModel: model,
      selectedProviders: [provider],
      selectedModels: [model],
    }),
  setSelectedModels: (models) =>
    set({
      selectedProviders: models.map((m) => m.provider),
      selectedModels: models.map((m) => m.model),
      selectedProvider: models[0]?.provider || "ollama",
      selectedModel: models[0]?.model || "",
    }),
  addSelectedModel: (provider: ModelProvider, model: string) =>
    set((state) => ({
      selectedProviders: [...state.selectedProviders, provider],
      selectedModels: [...state.selectedModels, model],
    })),
  removeSelectedModel: (index: number) =>
    set((state) => {
      const nextProviders = state.selectedProviders.filter(
        (_, i) => i !== index,
      );
      const nextModels = state.selectedModels.filter((_, i) => i !== index);
      return {
        selectedProviders: nextProviders,
        selectedModels: nextModels,
        selectedProvider: nextProviders[0] || "ollama",
        selectedModel: nextModels[0] || "",
      };
    }),
  updateSelectedModel: (index, provider, model) =>
    set((state) => {
      const nextProviders = [...state.selectedProviders];
      const nextModels = [...state.selectedModels];
      nextProviders[index] = provider;
      nextModels[index] = model;
      return {
        selectedProviders: nextProviders,
        selectedModels: nextModels,
        selectedProvider: nextProviders[0] || "ollama",
        selectedModel: nextModels[0] || "",
      };
    }),
  setAvailableModels: (models) =>
    set((state) => {
      const newState = {
        availableModels: { ...state.availableModels, ...models },
      };
      // If we just loaded ollama models and our selected model isn't in the list,
      // but we have some models, don't necessarily clear it if it was a custom one.
      return newState;
    }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setOllamaError: (error) => set({ ollamaError: error }),
  setPullingModel: (model) => set({ pullingModel: model }),
  setPullProgress: (progress) => set({ pullProgress: progress }),
  actions: {
    setDefaultModel: (model: string) => {
      localStorage.setItem("default_model", model);
      set({ defaultModel: model });
    },
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
