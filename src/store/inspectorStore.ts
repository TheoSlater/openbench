import { create } from "zustand";
import { InspectorState } from "@/types/inspector";

export const useInspectorStore = create<InspectorState>((set) => ({
  logs: [],
  actions: {
    addLog: (log) =>
      set((state) => ({
        logs: [log, ...state.logs].slice(0, 100), // Keep last 100 logs
      })),
    updateLog: (id, update) =>
      set((state) => ({
        logs: state.logs.map((log) =>
          log.id === id ? { ...log, ...update } : log,
        ),
      })),
    clearLogs: () => set({ logs: [] }),
  },
}));
