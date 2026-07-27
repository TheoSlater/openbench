import { create } from "zustand";

export type ViewportTab = {
  id: string;
};

type ViewportStore = {
  tabs: ViewportTab[];
  activeTabId: string | null;
  drawerOpen: boolean;
  drawerWidth: number;
  actions: {
    addTab: () => string;
    closeTab: (id: string) => void;
    selectTab: (id: string) => void;
    setTabOrder: (ids: string[]) => void;
    setDrawerOpen: (open: boolean) => void;
    setDrawerWidth: (width: number) => void;
    clear: () => void;
  };
};

const WIDTH_STORAGE_KEY = "poly_viewport_width";
export const VIEWPORT_MIN_WIDTH = 320;
export const VIEWPORT_MAX_WIDTH = 900;
let nextTabId = 1;

function loadWidth(): number {
  const raw =
    typeof localStorage === "undefined"
      ? NaN
      : Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(raw) &&
    raw >= VIEWPORT_MIN_WIDTH &&
    raw <= VIEWPORT_MAX_WIDTH
    ? raw
    : 440;
}

function withoutTab(
  state: Pick<ViewportStore, "tabs" | "activeTabId">,
  id: string,
) {
  const removedIndex = state.tabs.findIndex((tab) => tab.id === id);
  if (removedIndex < 0) return null;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const neighborIndex = Math.min(tabs.length - 1, Math.max(0, removedIndex - 1));
  const activeTabId =
    state.activeTabId === id ? tabs[neighborIndex]?.id ?? null : state.activeTabId;
  return { tabs, activeTabId, drawerOpen: tabs.length > 0 };
}

export const useViewportStore = create<ViewportStore>((set) => ({
  tabs: [],
  activeTabId: null,
  drawerOpen: false,
  drawerWidth: loadWidth(),
  actions: {
    addTab: () => {
      const id = `viewport-${nextTabId++}`;
      set((state) => ({
        tabs: [...state.tabs, { id }],
        activeTabId: id,
        drawerOpen: true,
      }));
      return id;
    },
    closeTab: (id) => set((state) => withoutTab(state, id) ?? state),
    selectTab: (activeTabId) => set({ activeTabId, drawerOpen: true }),
    setTabOrder: (ids) =>
      set((state) => {
        if (
          ids.length !== state.tabs.length ||
          new Set(ids).size !== state.tabs.length
        ) {
          return state;
        }
        const tabs = ids
          .map((id) => state.tabs.find((tab) => tab.id === id))
          .filter((tab): tab is ViewportTab => Boolean(tab));
        return tabs.length === state.tabs.length ? { tabs } : state;
      }),
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setDrawerWidth: (drawerWidth) => {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(drawerWidth));
      set({ drawerWidth });
    },
    clear: () => set({ tabs: [], activeTabId: null, drawerOpen: false }),
  },
}));

export function closeViewport(): void {
  useViewportStore.getState().actions.clear();
}

export function openViewportTerminal(): string {
  return useViewportStore.getState().actions.addTab();
}

export function closeViewportTab(id: string): void {
  useViewportStore.getState().actions.closeTab(id);
}

export function selectViewportTab(id: string): void {
  useViewportStore.getState().actions.selectTab(id);
}

export function setViewportTabOrder(ids: string[]): void {
  useViewportStore.getState().actions.setTabOrder(ids);
}

export function hideViewportDrawer(): void {
  useViewportStore.getState().actions.setDrawerOpen(false);
}
