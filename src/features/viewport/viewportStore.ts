import { create } from "zustand";

export type ViewportStatus = "loading" | "ready" | "closed";

export type ViewportSession = {
  chatId: string | null;
  openedBy: "chat" | "user";
  label: string;
  url: string;
  status: ViewportStatus;
};

type ViewportStore = {
  session: ViewportSession | null;
  browserOpen: boolean;
  drawerOpen: boolean;
  drawerWidth: number;
  actions: {
    opened: (session: Omit<ViewportSession, "status">) => void;
    browserOpened: () => void;
    browserClosed: () => void;
    statusChanged: (phase: ViewportStatus, url: string) => void;
    setDrawerOpen: (open: boolean) => void;
    setDrawerWidth: (width: number) => void;
    clear: () => void;
  };
};

const WIDTH_STORAGE_KEY = "poly_viewport_width";
export const VIEWPORT_MIN_WIDTH = 320;
export const VIEWPORT_MAX_WIDTH = 900;

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
  session: null,
  browserOpen: false,
  drawerOpen: false,
  drawerWidth: loadWidth(),
  actions: {
    opened: (session) =>
      set({
        session: { ...session, status: "loading" },
        browserOpen: true,
        drawerOpen: true,
      }),
    browserOpened: () => set({ browserOpen: true, drawerOpen: true }),
    browserClosed: () =>
      set({ session: null, browserOpen: false, drawerOpen: false }),
    statusChanged: (phase, url) =>
      set((state) => {
        if (!state.session) return state;
        if (phase === "closed") {
          return { session: null, browserOpen: false, drawerOpen: false };
        }
        return {
          session: {
            ...state.session,
            status: phase,
            url: url || state.session.url,
            label: url || state.session.label,
          },
        };
      }),
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setDrawerWidth: (drawerWidth) => {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(drawerWidth));
      set({ drawerWidth });
    },
    clear: () =>
      set({ session: null, browserOpen: false, drawerOpen: false }),
  },
}));

export function openViewportForUser(url: string): Promise<void> {
  openViewportPreviewUrl({
    chatId: null,
    url,
    openedBy: "user",
  });
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

export function openEmptyViewport(): void {
  useViewportStore.getState().actions.browserOpened();
}

export function closeViewportBrowser(): void {
  useViewportStore.getState().actions.browserClosed();
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
  const actions = useViewportStore.getState().actions;
  actions.opened({
    chatId: input.chatId,
    openedBy: input.openedBy,
    label: url,
    url,
  });
  actions.statusChanged("ready", url);
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
  if (useViewportStore.getState().session?.chatId === chatId) {
    closeViewport();
  }
}
