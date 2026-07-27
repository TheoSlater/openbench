import { create } from "zustand";

type ViewportStore = {
  /** Terminal tab ids, in display order. */
  tabs: string[];
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

export const useViewportStore = create<ViewportStore>((set) => ({
  tabs: [],
  activeTabId: null,
  drawerOpen: false,
  drawerWidth: loadWidth(),
  actions: {
    addTab: () => {
      const id = `viewport-${nextTabId++}`;
      set((state) => ({
        tabs: [...state.tabs, id],
        activeTabId: id,
        drawerOpen: true,
      }));
      return id;
    },
    closeTab: (id) =>
      set((state) => {
        const index = state.tabs.indexOf(id);
        if (index < 0) return state;
        const tabs = state.tabs.filter((tab) => tab !== id);
        const neighbor = tabs[Math.min(tabs.length - 1, Math.max(0, index - 1))];
        return {
          tabs,
          activeTabId: state.activeTabId === id ? neighbor ?? null : state.activeTabId,
          drawerOpen: tabs.length > 0,
        };
      }),
    selectTab: (activeTabId) => set({ activeTabId, drawerOpen: true }),
    // Must be a permutation: the Set check rejects a duplicated id, which
    // would otherwise render one tab twice and drop another.
    setTabOrder: (ids) =>
      set((state) =>
        ids.length === state.tabs.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => state.tabs.includes(id))
          ? { tabs: ids }
          : state,
      ),
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

/**
 * Reveals the drawer, only spawning a terminal when there is none.
 *
 * Hiding the drawer keeps its tabs, so reopening has to reattach to the
 * running shells — spawning unconditionally threw away the session every time
 * and looked like the terminal failing to persist.
 */
export function showViewportDrawer(): void {
  const { tabs, actions } = useViewportStore.getState();
  if (tabs.length) actions.setDrawerOpen(true);
  else actions.addTab();
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
