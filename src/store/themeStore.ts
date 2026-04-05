import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: (localStorage.getItem("theme_mode") as ThemeMode) || "dark",
  setMode: (mode) => {
    localStorage.setItem("theme_mode", mode);
    set({ mode });
  },
}));
