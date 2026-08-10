import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
  mode: ThemeMode;
  previewMode: ThemeMode | null;
  setMode: (mode: ThemeMode) => void;
  setPreviewMode: (mode: ThemeMode | null) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: (localStorage.getItem("theme_mode") as ThemeMode) || "dark",
  previewMode: null,
  setMode: (mode) => {
    localStorage.setItem("theme_mode", mode);
    set({ mode, previewMode: null });
  },
  setPreviewMode: (previewMode) => set({ previewMode }),
}));
