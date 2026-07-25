import { create } from "zustand";
import type { ProviderType } from "@/features/providers";
import type { ModelChoice } from "@/lib/models/model-choice";

export type ModelProvider = ProviderType;

export type AvailableModels = Record<string, string[]>;

export type SystemPrompt = {
  id: string;
  name: string;
  content: string;
  category?: string;
  baseStyle?: string;
  characteristics?: string[];
  instantAnswers?: boolean;
};

// PullProgress and OllamaModel moved to services/ollama/types.ts

type ModelStore = {
  selectedModel: string;
  selectedModels: string[];
  selectedProvider: ModelProvider;
  selectedProviders: ModelProvider[];
  selectedModelChoices: ModelChoice[];
  availableModels: AvailableModels;
  defaultModel: string;
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
  setSelectedModel: (provider: ModelProvider, model: string, providerConfigId?: number) => void;
  setSelectedModels: (
    models: { provider: ModelProvider; model: string; providerConfigId?: number }[],
  ) => void;
  addSelectedModel: (provider: ModelProvider, model: string, providerConfigId?: number) => void;
  removeSelectedModel: (index: number) => void;
  updateSelectedModel: (
    index: number,
    provider: ModelProvider,
    model: string,
    providerConfigId?: number,
  ) => void;
  setAvailableModels: (models: Partial<AvailableModels>) => void;
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

const defaultAvailableModels: AvailableModels = {};

const defaultSystemPrompt: SystemPrompt = {
  id: "default",
  name: "Default",
  content: "",
};

export const useModelStore = create<ModelStore>((set) => ({
  selectedModel: "",
  selectedModels: [],
  selectedProvider: "OllamaLocal",
  selectedProviders: [],
  selectedModelChoices: [],
  availableModels: defaultAvailableModels,
  systemPrompts: [defaultSystemPrompt],
  activeSystemPromptId: defaultSystemPrompt.id,
  defaultModel: localStorage.getItem("default_model") || "",
  setSelectedModel: (provider: ModelProvider, model: string, providerConfigId?: number) =>
    set({
      selectedProvider: provider,
      selectedModel: model,
      selectedProviders: [provider],
      selectedModels: [model],
      selectedModelChoices: [{ provider, model, providerConfigId }],
    }),
  setSelectedModels: (models) =>
    set({
      selectedProviders: models.map((m) => m.provider),
      selectedModels: models.map((m) => m.model),
      selectedModelChoices: models,
      selectedProvider: models[0]?.provider || "OllamaLocal",
      selectedModel: models[0]?.model || "",
    }),
  addSelectedModel: (provider: ModelProvider, model: string, providerConfigId?: number) =>
    set((state) => {
      if (!model && state.selectedModels.includes("")) return state;
      if (model && state.selectedModels.some((item, index) =>
        item === model &&
        state.selectedProviders[index] === provider &&
        state.selectedModelChoices[index]?.providerConfigId === providerConfigId,
      )) return state;
      return {
        selectedProviders: [...state.selectedProviders, provider],
        selectedModels: [...state.selectedModels, model],
        selectedModelChoices: [...state.selectedModelChoices, { provider, model, providerConfigId }],
      };
    }),
  removeSelectedModel: (index: number) =>
    set((state) => {
      const nextProviders = state.selectedProviders.filter(
        (_, i) => i !== index,
      );
      const nextModels = state.selectedModels.filter((_, i) => i !== index);
      const nextChoices = state.selectedModelChoices.filter((_, i) => i !== index);
      return {
        selectedProviders: nextProviders,
        selectedModels: nextModels,
        selectedModelChoices: nextChoices,
        selectedProvider: nextProviders[0] || "OllamaLocal",
        selectedModel: nextModels[0] || "",
      };
    }),
  updateSelectedModel: (index, provider, model, providerConfigId) =>
    set((state) => {
      if (state.selectedModels.some((item, itemIndex) =>
        itemIndex !== index &&
        item === model &&
        state.selectedProviders[itemIndex] === provider &&
        state.selectedModelChoices[itemIndex]?.providerConfigId === providerConfigId,
      )) return state;
      const nextProviders = [...state.selectedProviders];
      const nextModels = [...state.selectedModels];
      nextProviders[index] = provider;
      nextModels[index] = model;
      return {
        selectedProviders: nextProviders,
        selectedModels: nextModels,
        selectedModelChoices: nextModels.map((model, i) => ({
          provider: nextProviders[i],
          model,
          providerConfigId:
            i === index ? providerConfigId : state.selectedModelChoices[i]?.providerConfigId,
        })),
        selectedProvider: nextProviders[0] || "OllamaLocal",
        selectedModel: nextModels[0] || "",
      };
    }),
  setAvailableModels: (models) =>
    set({
      availableModels: models as AvailableModels,
    }),
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
        const nextPrompts = state.systemPrompts.filter((p) => p.id !== id);
        const wasActive = state.activeSystemPromptId === id;
        const nextActive = wasActive ? (nextPrompts[0]?.id ?? null) : state.activeSystemPromptId;
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
  OllamaLocal: "Ollama",
  OpenAICompatible: "OpenAI-compatible",
  AnthropicNative: "Anthropic",
  GeminiNative: "Gemini",
};
