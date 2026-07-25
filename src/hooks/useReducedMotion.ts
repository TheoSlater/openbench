import { useSettingsStore } from "@/store/settingsStore";

export function useReducedMotion(): boolean {
  return useSettingsStore((s) => s.performance.reduceMotion);
}
