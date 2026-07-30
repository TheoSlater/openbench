import { create } from "zustand";
import type { ProviderType } from "@/features/providers";

export type ModelProvider = ProviderType;

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
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
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

const defaultSystemPrompt: SystemPrompt = {
  id: "default",
  name: "Default",
  content: "",
};

export const useModelStore = create<ModelStore>((set) => ({
  systemPrompts: [defaultSystemPrompt],
  activeSystemPromptId: defaultSystemPrompt.id,
  actions: {
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
