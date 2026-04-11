import { create } from "zustand";
import { persist } from "zustand/middleware";
import { loggedInvoke } from "@/lib/utils";

export type OllamaConfig = {
  baseUrl: string;
};

type SettingsState = {
  ollamaConfig: OllamaConfig;
  actions: {
    setOllamaConfig: (config: OllamaConfig) => Promise<void>;
    syncToBackend: () => Promise<void>;
  };
};

const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: "http://localhost:11434",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ollamaConfig: DEFAULT_OLLAMA_CONFIG,
      actions: {
        setOllamaConfig: async (config) => {
          set({ ollamaConfig: config });
          await get().actions.syncToBackend();
        },
        syncToBackend: async () => {
          const { ollamaConfig } = get();
          try {
            await loggedInvoke("set_ollama_config", { 
              baseUrl: ollamaConfig.baseUrl, 
              apiKey: null 
            });
          } catch (error) {
            console.error("Failed to sync settings to backend:", error);
          }
        },
      },
    }),
    {
      name: "settings-storage",
      partialize: (state) => ({
        ollamaConfig: state.ollamaConfig,
      }),
    }
  )
);
