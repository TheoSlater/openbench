import type { ThemeMode } from "@/store/themeStore";

const THEME_CYCLE: ThemeMode[] = ["system", "dark", "light"];

export function getNextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length];
}
