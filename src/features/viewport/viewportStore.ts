import { create } from "zustand";

type ViewportStore = {
  /** Terminal and sandbox preview tab ids, in display order. */
  tabs: string[];
  previews: Record<number, SandboxPreview>;
  activeTabId: string | null;
  drawerOpen: boolean;
  drawerWidth: number;
  actions: {
    addTab: () => string;
    addAiTab: () => void;
    setPreview: (preview: SandboxPreview) => void;
    clearSandboxPreviews: (sandboxId: string) => void;
    closeTab: (id: string) => void;
    selectTab: (id: string) => void;
    setTabOrder: (ids: string[]) => void;
    setDrawerOpen: (open: boolean) => void;
    setDrawerWidth: (width: number) => void;
    clear: () => void;
  };
};

export type SandboxPreview = {
  sandboxId: string;
  containerPort: number;
  hostPort: number;
  url: string;
};

const WIDTH_STORAGE_KEY = "poly_viewport_width";
export const VIEWPORT_MIN_WIDTH = 320;
export const VIEWPORT_MAX_WIDTH = 900;
/** Fixed tab id for the read-only transcript of commands the AI runs. */
export const AI_TERMINAL_TAB_ID = "ai-terminal";
export const SANDBOX_PREVIEW_TAB_PREFIX = "sandbox-preview-";
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
  previews: {},
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
    addAiTab: () =>
      set((state) => ({
        tabs: state.tabs.includes(AI_TERMINAL_TAB_ID)
          ? state.tabs
          : [...state.tabs, AI_TERMINAL_TAB_ID],
        activeTabId: AI_TERMINAL_TAB_ID,
        drawerOpen: true,
      })),
    setPreview: (preview) =>
      set((state) => {
        const id = previewTabId(preview.hostPort);
        const existing = state.previews[preview.hostPort];
        if (
          existing?.sandboxId === preview.sandboxId &&
          existing?.containerPort === preview.containerPort &&
          existing?.hostPort === preview.hostPort &&
          existing?.url === preview.url
        ) {
          return state;
        }
        const known = Boolean(existing);
        return {
          previews: { ...state.previews, [preview.hostPort]: preview },
          tabs: state.tabs.includes(id) ? state.tabs : [...state.tabs, id],
          activeTabId: known ? state.activeTabId : id,
          drawerOpen: known ? state.drawerOpen : true,
        };
      }),
    clearSandboxPreviews: (sandboxId) =>
      set((state) => {
        const ports = new Set(
          Object.values(state.previews)
            .filter((preview) => preview.sandboxId === sandboxId)
            .map((preview) => preview.hostPort),
        );
        if (!ports.size) return state;
        const tabs = state.tabs.filter((id) => !ports.has(Number(id.slice(SANDBOX_PREVIEW_TAB_PREFIX.length))));
        return {
          previews: Object.fromEntries(
            Object.entries(state.previews).filter(([port]) => !ports.has(Number(port))),
          ),
          tabs,
          activeTabId: ports.has(Number(state.activeTabId?.slice(SANDBOX_PREVIEW_TAB_PREFIX.length)))
            ? tabs[tabs.length - 1] ?? null
            : state.activeTabId,
          drawerOpen: tabs.length > 0,
        };
      }),
    closeTab: (id) =>
      set((state) => {
        const index = state.tabs.indexOf(id);
        if (index < 0) return state;
        const tabs = state.tabs.filter((tab) => tab !== id);
        const previews = isPreviewTab(id)
          ? Object.fromEntries(
            Object.entries(state.previews).filter(([port]) => previewTabId(Number(port)) !== id),
          )
          : state.previews;
        const neighbor = tabs[Math.min(tabs.length - 1, Math.max(0, index - 1))];
        return {
          tabs,
          previews,
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
    clear: () => set({ tabs: [], previews: {}, activeTabId: null, drawerOpen: false }),
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

/** Opens (or selects) the transcript tab for commands the AI has run. */
export function openAiTerminalTab(): void {
  useViewportStore.getState().actions.addAiTab();
}

export function previewTabId(hostPort: number): string {
  return `${SANDBOX_PREVIEW_TAB_PREFIX}${hostPort}`;
}

export function isPreviewTab(id: string): boolean {
  return id.startsWith(SANDBOX_PREVIEW_TAB_PREFIX);
}

export function previewForTab(id: string): SandboxPreview | undefined {
  if (!isPreviewTab(id)) return undefined;
  const port = Number(id.slice(SANDBOX_PREVIEW_TAB_PREFIX.length));
  return useViewportStore.getState().previews[port];
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
