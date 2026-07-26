import { create } from "zustand";

export type ViewportStatus = "loading" | "ready" | "closed";
export type ViewportTabType = "browser" | "terminal";

export type ViewportSession = {
  chatId: string | null;
  openedBy: "chat" | "user";
  label: string;
  url: string;
  status: ViewportStatus;
};

export type ViewportTab = {
  id: string;
  type: ViewportTabType;
  session: ViewportSession | null;
};

type ViewportStore = {
  tabs: ViewportTab[];
  activeTabId: string | null;
  drawerOpen: boolean;
  drawerWidth: number;
  actions: {
    addTab: (type: ViewportTabType, session?: ViewportSession | null) => string;
    closeTab: (id: string) => void;
    closeTabs: (predicate: (tab: ViewportTab) => boolean) => void;
    selectTab: (id: string) => void;
    setTabOrder: (ids: string[]) => void;
    updateBrowserUrl: (id: string, url: string) => void;
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

function withoutTabs(
  state: Pick<ViewportStore, "tabs" | "activeTabId">,
  predicate: (tab: ViewportTab) => boolean,
) {
  const removed = state.tabs.filter(predicate);
  if (!removed.length) return null;
  const tabs = state.tabs.filter((tab) => !predicate(tab));
  const activeRemoved = removed.some((tab) => tab.id === state.activeTabId);
  const removedIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const neighborIndex = Math.min(
    tabs.length - 1,
    Math.max(0, removedIndex - 1),
  );
  const activeTabId = activeRemoved
    ? tabs[neighborIndex]?.id ?? null
    : state.activeTabId;
  return { tabs, activeTabId, drawerOpen: tabs.length > 0 };
}

export const useViewportStore = create<ViewportStore>((set) => ({
  tabs: [],
  activeTabId: null,
  drawerOpen: false,
  drawerWidth: loadWidth(),
  actions: {
    addTab: (type, session = null) => {
      const id = `viewport-${nextTabId++}`;
      set((state) => ({
        tabs: [...state.tabs, { id, type, session }],
        activeTabId: id,
        drawerOpen: true,
      }));
      return id;
    },
    closeTab: (id) =>
      set((state) => withoutTabs(state, (tab) => tab.id === id) ?? state),
    closeTabs: (predicate) =>
      set((state) => withoutTabs(state, predicate) ?? state),
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
    updateBrowserUrl: (id, url) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === id && tab.type === "browser"
            ? {
                ...tab,
                session: {
                  chatId: null,
                  openedBy: "user",
                  status: "ready",
                  ...tab.session,
                  url,
                  label: url,
                },
              }
            : tab,
        ),
      })),
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setDrawerWidth: (drawerWidth) => {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(drawerWidth));
      set({ drawerWidth });
    },
    clear: () => set({ tabs: [], activeTabId: null, drawerOpen: false }),
  },
}));

export function openViewportForUser(url: string): Promise<void> {
  openViewportPreviewUrl({ chatId: null, url, openedBy: "user" });
  return Promise.resolve();
}

export async function bindViewportOpenRequests(
  getChatId: () => string | null,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ url: string }>("viewport-open-request", (event) => {
    openViewportPreviewUrl({
      chatId: getChatId(),
      url: event.payload.url,
      openedBy: "chat",
    });
  });
}

export function closeViewport(): void {
  useViewportStore.getState().actions.clear();
}

export function openEmptyViewport(): string {
  return useViewportStore.getState().actions.addTab("browser");
}

export function openViewportTerminal(): string {
  return useViewportStore.getState().actions.addTab("terminal");
}

export function closeViewportTab(id: string): void {
  useViewportStore.getState().actions.closeTab(id);
}

export function closeViewportTabs(type: ViewportTabType): void {
  useViewportStore.getState().actions.closeTabs((tab) => tab.type === type);
}

export function selectViewportTab(id: string): void {
  useViewportStore.getState().actions.selectTab(id);
}

export function setViewportTabOrder(ids: string[]): void {
  useViewportStore.getState().actions.setTabOrder(ids);
}

export function updateViewportBrowserUrl(id: string, input: string): void {
  const url = safeHttpUrl(input);
  if (url) useViewportStore.getState().actions.updateBrowserUrl(id, url);
}

export function hideViewportDrawer(): void {
  useViewportStore.getState().actions.setDrawerOpen(false);
}

export function openViewportPreviewUrl(input: {
  chatId: string | null;
  url: string;
  openedBy: ViewportSession["openedBy"];
}): void {
  const url = safeHttpUrl(input.url);
  if (!url) return;
  useViewportStore.getState().actions.addTab("browser", {
    chatId: input.chatId,
    openedBy: input.openedBy,
    label: url,
    url,
    status: "ready",
  });
}

function safeHttpUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function closeViewportForChat(chatId: string): void {
  useViewportStore
    .getState()
    .actions.closeTabs((tab) => tab.session?.chatId === chatId);
}
