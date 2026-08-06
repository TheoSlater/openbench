import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PromptPresetId } from "@/lib/constants/promptPresets";
import type { WebSearchSettings } from "@/features/web-search/types";
import { startupError, startupPhase } from "@/lib/utils/startupDiagnostics";
import { createSafeJsonStorage } from "./persistStorage";

export type GeneralSettings = {
  language: string;
  notifications: boolean;
  systemPrompt: string;
  webSearch: WebSearchSettings;
  webSearchEnabled: boolean;
  experimentalFeatures: boolean;
  betaFeatures: boolean;
  previewFeatures: boolean;
  mobileWebAccess: boolean;
  showModelInEmptyState: boolean;
  voiceModeExperimental: boolean;
  memoryBeta: boolean;
};

export type BrowserTtsSettings = {
  voiceURI: string;
  speed: number;
  pitch: number;
};

export type TtsEngine = "auto" | "native" | "supertonic";

export type SupertonicTtsSettings = {
  voiceName: string;
  speed: number;
  totalStep: number;
  silenceDuration: number;
};

export type TtsSettings = {
  engine: TtsEngine;
  voiceColorsEnabled: boolean;
  browser: BrowserTtsSettings;
  supertonic: SupertonicTtsSettings;
};

export type DictationSettings = {
  enabled: boolean;
  language: string;
  autoStart: boolean;
  /** Voice-activity threshold scale: >1 hears quieter speech, <1 needs louder. */
  vadSensitivity: number;
};

export type PerformanceSettings = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  appZoom: number;
  keepViewportActive: boolean;
};

type SettingsState = {
  general: GeneralSettings;
  tts: TtsSettings;
  dictation: DictationSettings;
  performance: PerformanceSettings;
  selectedPromptPreset: PromptPresetId;
  actions: {
    updateGeneral: (update: Partial<GeneralSettings>) => void;
    updateTts: (update: Partial<TtsSettings>) => void;
    updateDictation: (update: Partial<DictationSettings>) => void;
    updatePerformance: (update: Partial<PerformanceSettings>) => void;
    setPromptPreset: (id: PromptPresetId) => void;
  };
};

const defaultTts: TtsSettings = {
  engine: "auto",
  voiceColorsEnabled: true,
  browser: {
    voiceURI: "",
    speed: 1.0,
    pitch: 1.0,
  },
  supertonic: {
    voiceName: "M1",
    speed: 1.0,
    totalStep: 10,
    silenceDuration: 0.3,
  },
};

const SETTINGS_VERSION = 30;

function osPrefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export const defaultDictation: DictationSettings = {
  enabled: true,
  language: "en",
  autoStart: false,
  vadSensitivity: 1,
};

export const defaultPerformance: PerformanceSettings = {
  reduceMotion: osPrefersReducedMotion(),
  reduceTransparency: false,
  appZoom: 1,
  keepViewportActive: false,
};

function createDefaultWebSearchSettings(): WebSearchSettings {
  return { provider: "local" };
}

function defaultSettingsState(): Omit<SettingsState, "actions"> {
  return {
    general: {
      language: "en",
      notifications: true,
      systemPrompt: "",
      webSearch: createDefaultWebSearchSettings(),
      webSearchEnabled: false,
      experimentalFeatures: false,
      betaFeatures: false,
      previewFeatures: false,
      mobileWebAccess: false,
      showModelInEmptyState: false,
      voiceModeExperimental: false,
      memoryBeta: false,
    },
    tts: { ...defaultTts },
    dictation: { ...defaultDictation },
    performance: { ...defaultPerformance },
    selectedPromptPreset: "default" as PromptPresetId,
  };
}

// Runs on every rehydrate (unlike migrate, which only runs on version
// bumps): fills in any missing nested field from defaults, so adding a new
// settings key no longer requires a migration step and a half-stamped
// storage (e.g. from a dev HMR race) heals itself on next load.
export function mergeSettingsWithDefaults(
  persisted: unknown,
  current: SettingsState,
): SettingsState {
  const p = (persisted ?? {}) as Partial<Omit<SettingsState, "actions">>;
  return {
    ...current,
    ...p,
    general: {
      ...current.general,
      ...p.general,
      webSearch: {
        ...current.general.webSearch,
        ...p.general?.webSearch,
      },
    },
    tts: {
      ...current.tts,
      ...p.tts,
      browser: { ...current.tts.browser, ...p.tts?.browser },
      supertonic: { ...current.tts.supertonic, ...p.tts?.supertonic },
    },
    dictation: { ...current.dictation, ...p.dictation },
    performance: { ...current.performance, ...p.performance },
    actions: current.actions,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettingsState(),
      actions: {
        updateGeneral: (update) =>
          set((s) => ({ general: { ...s.general, ...update } })),

        updateTts: (update) =>
          set((s) => ({
            tts: {
              ...defaultTts,
              ...s.tts,
              ...update,
              browser: { ...defaultTts.browser, ...s.tts.browser, ...(update.browser ?? {}) },
              supertonic: { ...defaultTts.supertonic, ...s.tts.supertonic, ...(update.supertonic ?? {}) },
            },
          })),

        updateDictation: (update) =>
          set((s) => ({ dictation: { ...s.dictation, ...update } })),

        updatePerformance: (update) =>
          set((s) => ({ performance: { ...s.performance, ...update } })),

        setPromptPreset: (id) => set({ selectedPromptPreset: id }),
      },
    }),
    {
      name: "polyui:settings",
      version: SETTINGS_VERSION,
      storage: createSafeJsonStorage<SettingsState>(),
      merge: mergeSettingsWithDefaults,
      migrate: (persisted, version) => {
        startupPhase(`settings migration start: ${version} -> ${SETTINGS_VERSION}`);
        if (version > SETTINGS_VERSION) {
          startupError(`settings future version ${version}; using defaults`);
          return defaultSettingsState() as SettingsState;
        }
        const state = persisted as any;
        if (state?.tts) {
          state.tts = {
            ...defaultTts,
            ...state.tts,
            browser: { ...defaultTts.browser, ...state.tts.browser },
            supertonic: { ...defaultTts.supertonic, ...state.tts.supertonic },
          };
        }
        if (version < 5) {
          delete state.account;
        }
        if (version < 6 && state?.general) {
          state.general.webSearch = createDefaultWebSearchSettings();
          delete state.general.exaApiKey;
        }
        if (version < 9) {
          state.performance = { ...defaultPerformance, ...state.performance };
        }
        if (version < 10 && state?.general) {
          state.general.experimentalFeatures = Boolean(state.general.experimentalFeatures);
        }
        if (version < 11 && state?.performance) {
          delete state.performance.autoOptimize;
          delete state.performance.profile;
          delete state.performance.lastHardwareScan;
          delete state.performance.optimizedAt;
        }
        if (version < 12) {
          state.dictation = { ...defaultDictation, ...state.dictation };
        }
        if (version < 13) {
          state.performance = { ...defaultPerformance, ...state.performance };
        }
        if (version < 14 && state?.general) {
          state.general.showModelInEmptyState = false;
        }
        if (version < 15 && state?.general) {
          state.general.webSearch = {
            ...createDefaultWebSearchSettings(),
            ...state.general.webSearch,
            provider: state.general.webSearch?.provider ?? "local",
          };
        }
        if (version < 16) {
          state.performance = { ...defaultPerformance, ...state.performance, keepViewportActive: false };
        }
        if (version < 17 && state?.general) {
          state.general.mobileWebAccess = false;
        }
        if (version < 19 && state?.general) {
          state.general.voiceModeExperimental = false;
        }
        // 22, not 20: dev sessions hot-reloaded between the version bump and
        // this branch landing were stamped 20/21 without the new field, so
        // the merge must re-run for them. Defaults-merge also heals any other
        // missing dictation key.
        if (version < 22 && state?.dictation) {
          state.dictation = { ...defaultDictation, ...state.dictation };
          state.dictation.vadSensitivity ??= 1;
        }
        if (version < 24 && state?.general) {
          state.general.memoryBeta = false;
        }
        if (version < 25 && osPrefersReducedMotion()) {
          state.performance = {
            ...defaultPerformance,
            ...state.performance,
            reduceMotion: true,
          };
        }
        if (version < 26 && state?.general) {
          state.general.betaFeatures = Boolean(state.general.memoryBeta);
          state.general.previewFeatures = false;
        }
        if (version < 28 && state?.general?.webSearch) {
          delete state.general.webSearch.apiKeys;
        }
        if (version < 29) {
          delete state.codex;
          delete state.codexWorkspace;
          delete state.claude;
          delete state.claudeWorkspace;
        }
        if (version < 30 && state?.general) {
          delete state.general.terminalEmulator;
        }
        startupPhase("settings migration complete");
        return state as SettingsState;
      },
      onRehydrateStorage: () => {
        startupPhase("settings hydrate begin");
        return (_state, error) => {
          if (error) {
            startupError("settings hydrate failed", error);
          } else {
            startupPhase("settings hydrate complete");
          }
        };
      },
      partialize: ({
        general,
        tts,
        dictation,
        performance,
        selectedPromptPreset,
      }) =>
        ({
          general,
          tts,
          dictation,
          performance,
          selectedPromptPreset,
        }) as SettingsState,
    },
  ),
);
