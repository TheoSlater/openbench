import { create } from "zustand";
import type { OllamaState, OllamaModel, PullProgress } from "./types";
import { ollamaClient } from "./client";
import { getHealthMonitor } from "./health-monitor";
import { useNotificationStore } from "@/store/notificationStore";
import { mergeModelOptions } from "@/lib/models/model-selector";

// ── Session-storage cache helpers ──────────────────────────────────────────────
const SESSION_LOCAL_KEY = "ob:models:local";
const SESSION_EXTERNAL_KEY = "ob:models:external";

function readSessionModels(key: string): OllamaModel[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw) as OllamaModel[];
  } catch { /* corrupt / unavailable – ignore */ }
  return [];
}

function writeSessionModels(key: string, models: OllamaModel[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(models));
  } catch { /* quota exceeded – ignore */ }
}

interface OllamaStore {
  state: OllamaState;
  localModels: OllamaModel[];
  externalModels: OllamaModel[];
  models: OllamaModel[];
  externalModelsLoaded: boolean;
  externalModelsLoading: boolean;
  externalModelsError: string | null;
  error: string | null;
  pullingModel: string | null;
  pullProgress: PullProgress | null;
  
  actions: {
    start: () => void;
    stop: () => void;
    refresh: () => Promise<void>;
    loadExternalModels: (force?: boolean) => Promise<void>;
    clearExternalModels: () => void;
    setPullingModel: (model: string | null) => void;
    setPullProgress: (progress: PullProgress | null) => void;
  };
}

const healthMonitor = getHealthMonitor();

export const useOllamaStore = create<OllamaStore>((set, get) => {
  healthMonitor.onStateChange((state, models, error) => {
    const prevState = get().state;
    
    if (state === "online" && models) {
      if (prevState !== "online" && prevState !== "loading") {
        useNotificationStore.getState().actions.add({
          type: "success",
          message: "Provider connected",
          description: "Model connection is ready.",
        });
      }
      writeSessionModels(SESSION_LOCAL_KEY, models);
      set((current) => ({
        state,
        localModels: models,
        models: mergeModelOptions(models, current.externalModels),
        error: null,
      }));
    } else if (state === "offline" && prevState === "online") {
      useNotificationStore.getState().actions.add({
        type: "error",
        message: "LLM Providers Offline",
        description: "All provider connections lost. Attempting to reconnect...",
        duration: 5000,
      });
      set((current) => ({
        state,
        models: mergeModelOptions(current.localModels, current.externalModels),
        externalModelsLoaded: false,
        error: error ?? null,
      }));
    } else {
      set({
        state,
        error: error ?? null,
        ...(state === "offline" && prevState !== "offline"
          ? { externalModelsLoaded: false }
          : {}),
      });
    }
  });

  // Hydrate from session cache so models render instantly
  const cachedLocal = readSessionModels(SESSION_LOCAL_KEY);
  const cachedExternal = readSessionModels(SESSION_EXTERNAL_KEY);
  const cachedModels = mergeModelOptions(cachedLocal, cachedExternal);
  const hasCachedModels = cachedModels.length > 0;

  return {
    state: hasCachedModels ? "online" : "loading",
    localModels: cachedLocal,
    externalModels: cachedExternal,
    models: cachedModels,
    externalModelsLoaded: cachedExternal.length > 0,
    externalModelsLoading: false,
    externalModelsError: null,
    error: null,
    pullingModel: null,
    pullProgress: null,

    actions: {
      start: () => {
        healthMonitor.start();
      },
      stop: () => {
        healthMonitor.stop();
      },
      refresh: async () => {
        await healthMonitor.refresh();
      },
      loadExternalModels: async (force = false) => {
        const { externalModelsLoaded, externalModelsLoading } = get();
        if (externalModelsLoading || (externalModelsLoaded && !force)) return;

        set({ externalModelsLoading: true, externalModelsError: null });
        try {
          const externalModels = await ollamaClient.getProviderModels(
            "OpenAICompatible",
          );
          writeSessionModels(SESSION_EXTERNAL_KEY, externalModels);
          set((current) => ({
            externalModels,
            models: mergeModelOptions(current.localModels, externalModels),
            externalModelsLoaded: true,
            externalModelsLoading: false,
            externalModelsError: null,
          }));
        } catch (error) {
          set((current) => ({
            externalModelsLoaded: false,
            externalModelsLoading: false,
            externalModelsError:
              error instanceof Error ? error.message : String(error),
            models: mergeModelOptions(current.localModels, current.externalModels),
          }));
        }
      },
      clearExternalModels: () =>
        set((current) => ({
          externalModels: [],
          models: current.localModels,
          externalModelsLoaded: false,
          externalModelsLoading: false,
          externalModelsError: null,
        })),
      setPullingModel: (model) => set({ pullingModel: model }),
      setPullProgress: (progress) => set({ pullProgress: progress }),
    },
  };
});
