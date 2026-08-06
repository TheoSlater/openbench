import { create } from "zustand";
import type { OverlayPosition } from "@/features/debug-overlay/types";

type DebugOverlayConfig = {
  enabled: boolean;
  position: OverlayPosition;
};

type DevStore = {
  devMode: boolean;
  debugOverlay: DebugOverlayConfig;
  actions: {
    setDevMode: (on: boolean) => void;
    toggleDevMode: () => void;
    setDebugOverlay: (patch: Partial<DebugOverlayConfig>) => void;
  };
};

export const defaultDebugOverlay: DebugOverlayConfig = {
  enabled: false,
  position: "top-right",
};

export const useDevStore = create<DevStore>((set) => ({
  devMode: false,
  debugOverlay: { ...defaultDebugOverlay },
  actions: {
    setDevMode: (on) => set({ devMode: on }),
    toggleDevMode: () => set((s) => ({ devMode: !s.devMode })),
    setDebugOverlay: (patch) =>
      set((s) => ({ debugOverlay: { ...s.debugOverlay, ...patch } })),
  },
}));