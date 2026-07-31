import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
    removeItem: (key: string) => store.delete(key),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  },
  writable: true,
  configurable: true,
});

import {
  mergeSettingsWithDefaults,
  migrateTerminalEmulatorV27,
  useSettingsStore,
} from "../src/store/settingsStore";

describe("mergeSettingsWithDefaults", () => {
  const defaults = useSettingsStore.getState();

  it("fills missing nested fields from defaults (heals half-stamped storage)", () => {
    const merged = mergeSettingsWithDefaults(
      {
        general: { language: "fr" },
        dictation: { enabled: false },
        tts: { supertonic: { voiceName: "F2" } },
      },
      defaults,
    );

    expect(merged.general.language).toBe("fr");
    expect(merged.dictation.enabled).toBe(false);
    expect(merged.tts.supertonic.voiceName).toBe("F2");
    // Fields absent from the persisted blob come from defaults.
    expect(merged.dictation.vadSensitivity).toBe(defaults.dictation.vadSensitivity);
    expect(merged.general.webSearch).toEqual(defaults.general.webSearch);
    expect(merged.general.betaFeatures).toBe(false);
    expect(merged.general.previewFeatures).toBe(false);
    expect(merged.general.terminalEmulator).toBe("native");
    expect(merged.tts.supertonic.speed).toBe(defaults.tts.supertonic.speed);
    expect(merged.performance).toEqual(defaults.performance);
    expect(merged.actions).toBe(defaults.actions);
  });

  it("survives null/empty persisted state", () => {
    const merged = mergeSettingsWithDefaults(null, defaults);
    expect(merged.general).toEqual(defaults.general);
    expect(merged.actions).toBe(defaults.actions);
  });

  it("keeps opt-in surfaces off and web search local by default", () => {
    expect(defaults.general.webSearch.provider).toBe("local");
    expect(defaults.general.webSearchEnabled).toBe(false);
    expect(defaults.general.mobileWebAccess).toBe(false);
    expect(defaults.general.betaFeatures).toBe(false);
    expect(defaults.general.previewFeatures).toBe(false);
    expect(defaults.general.terminalEmulator).toBe("native");
  });
});
