import { useCallback, useEffect, useRef, useState } from "react";
import { Globe2, Loader2, PanelRightIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { SUPPORTS_CHROMIUM_BROWSER } from "@/lib/utils/platform";
import { useSettingsStore } from "@/store/settingsStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import * as native from "../native";
import type { CefNavState } from "../native";
import {
  moveBrowserHistory,
  pushBrowserHistory,
  resolveBrowserInput,
  type BrowserHistoryState,
} from "../browserNavigation";
import {
  closeViewportBrowser,
  hideViewportDrawer,
  openViewportPreviewUrl,
  useViewportStore,
} from "../viewportStore";
import { useDrawerResize } from "../hooks/useDrawerResize";
import { useViewportSuspension } from "../hooks/useViewportSuspension";
import { BrowserNewTabEmpty } from "./BrowserNewTabEmpty";
import { BrowserToolbar } from "./BrowserToolbar";
import { CefViewport } from "./CefViewport";
import { browserTabLabel, DrawerTab } from "./DrawerTab";

export function ViewportDrawer() {
  const session = useViewportStore((state) => state.session);
  const browserOpen = useViewportStore((state) => state.browserOpen);
  const open = useViewportStore((state) => state.drawerOpen);
  const width = useViewportStore((state) => state.drawerWidth);
  const setDrawerWidth = useViewportStore((state) => state.actions.setDrawerWidth);
  const reduceMotion = useReducedMotion();
  const reduceTransparency = useSettingsStore((state) => state.performance.reduceTransparency);
  const experimentalChromiumBrowser = useSettingsStore(
    (state) => state.general.experimentalChromiumBrowser,
  );
  const useChromiumBrowser = SUPPORTS_CHROMIUM_BROWSER && experimentalChromiumBrowser;

  const [url, setUrl] = useState("");
  // Bumped to remount the browser surface, which is how a reload is forced for
  // anything that cannot reload in place.
  const [frameNonce, setFrameNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  // Chromium owns history on the CEF path. The iframe path cannot read a
  // cross-origin frame's history, so it keeps its own list and re-mounts.
  const [navState, setNavState] = useState<CefNavState>({
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [history, setHistory] = useState<BrowserHistoryState>({ entries: [], index: -1 });
  // Set while replaying history, so the resulting session URL is not pushed
  // back onto the stack as a new entry.
  const historyMoveRef = useRef(false);
  // The page Chromium reports it is showing, so the navigate effect below does
  // not echo an address change back as a fresh navigation.
  const cefUrlRef = useRef("");

  const { dragging, startResize } = useDrawerResize(width, setDrawerWidth);
  const visible = Boolean(open && (browserOpen || session));
  const browserLoading = Boolean(session?.url && frameLoading && !browserError);

  const remountBrowser = useCallback(() => {
    setBrowserError("");
    setFrameLoading(true);
    setFrameNonce((nonce) => nonce + 1);
  }, []);

  const { suspended, offloaded } = useViewportSuspension({
    visible,
    hasContent: Boolean(session?.url || browserOpen),
    onWake: () => {
      if (session?.url) remountBrowser();
    },
  });

  const handleFirstFrame = useCallback(() => {
    setBrowserError("");
    setFrameLoading(false);
  }, []);
  const handleBrowserError = useCallback((message: string) => setBrowserError(message), []);
  const handleAddressChange = useCallback((address: string) => {
    setUrl(address);
    // Record where Chromium moved to, so the navigate effect does not read it
    // back as a new destination.
    cefUrlRef.current = address;
    setHistory((state) => pushBrowserHistory(state, address));
  }, []);
  const handleNavState = useCallback((state: CefNavState) => {
    setNavState(state);
    if (state.isLoading) setFrameLoading(true);
  }, []);

  useEffect(() => {
    if (!session?.url) {
      setFrameLoading(false);
      return;
    }
    setUrl(session.url);
    setBrowserError("");
    setFrameLoading(true);
    if (useChromiumBrowser) {
      // Navigate in place. Remounting would build a fresh browser and throw
      // away the session history that back/forward walk.
      if (session.url !== cefUrlRef.current) {
        cefUrlRef.current = session.url;
        void native.cefViewportNavigate(session.url).catch(remountBrowser);
      }
      return;
    }
    setHistory((state) => {
      if (historyMoveRef.current) {
        historyMoveRef.current = false;
        return state;
      }
      return pushBrowserHistory(state, session.url);
    });
  }, [session?.url, useChromiumBrowser, remountBrowser]);

  const openTypedUrl = () => {
    const href = resolveBrowserInput(url);
    if (href) openViewportPreviewUrl({ chatId: null, url: href, openedBy: "user" });
  };

  const moveHistory = (delta: -1 | 1) => {
    if (useChromiumBrowser) {
      const go = delta === -1 ? native.cefViewportBack : native.cefViewportForward;
      void go().catch(() => undefined);
      return;
    }
    const moved = moveBrowserHistory(history, delta);
    if (!moved.url) return;
    historyMoveRef.current = true;
    setHistory(moved.state);
    openViewportPreviewUrl({ chatId: null, url: moved.url, openedBy: "user" });
  };

  const openExternal = () => {
    const href = session?.url || resolveBrowserInput(url);
    if (!href) return;
    void openUrl(href).catch(() => window.open(href, "_blank", "noopener,noreferrer"));
  };

  const reloadBrowser = () => {
    if (!session?.url) return;
    if (useChromiumBrowser) {
      // Reload in place: remounting would recreate the browser at the stale
      // session URL and lose any in-page navigation.
      setFrameLoading(true);
      void native.cefViewportReload().catch(remountBrowser);
      return;
    }
    remountBrowser();
  };

  return (
    <aside
      aria-label="Viewport"
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground",
        !dragging && !reduceMotion && "transition-[width] duration-200 ease-out",
        visible && "border-l border-border",
      )}
      style={{ width: visible ? width : 0, maxWidth: "calc(100% - 320px)" }}
    >
      <div
        className="absolute inset-y-0 left-0 z-20 w-1 cursor-ew-resize touch-none bg-transparent hover:bg-border"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize viewport"
        onPointerDown={startResize}
      />
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3">
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <DrawerTab
            icon={<Globe2 />}
            label={browserTabLabel(session?.label || session?.url)}
            onClose={closeViewportBrowser}
          />
        </nav>
        {browserLoading ? (
          <Loader2
            className={cn("size-4 shrink-0 text-muted-foreground", !reduceMotion && "animate-spin")}
          />
        ) : null}
        <IconButton
          size="small"
          aria-label="Hide viewport"
          title="Hide viewport"
          onClick={hideViewportDrawer}
        >
          <PanelRightIcon className="-scale-x-100" size={16} />
        </IconButton>
      </header>
      <section className="flex min-h-0 flex-1 flex-col bg-sidebar">
        <BrowserToolbar
          url={url}
          onUrlChange={setUrl}
          onNavigate={openTypedUrl}
          canGoBack={useChromiumBrowser ? navState.canGoBack : history.index > 0}
          canGoForward={
            useChromiumBrowser
              ? navState.canGoForward
              : history.index < history.entries.length - 1
          }
          onGoBack={() => moveHistory(-1)}
          onGoForward={() => moveHistory(1)}
          onReload={reloadBrowser}
          canReload={Boolean(session?.url)}
          onOpenExternal={openExternal}
          canOpenExternal={Boolean(session?.url || url.trim())}
        />
        <div className="relative min-h-0 flex-1 bg-sidebar">
          {session?.url && !suspended && !offloaded ? (
            <>
              {useChromiumBrowser ? (
                <CefViewport
                  // Not keyed on the URL: one browser for the surface's whole
                  // life, so navigating never rebuilds Chromium. The nonce is
                  // still the escape hatch for a forced remount.
                  key={frameNonce}
                  initialUrl={session.url}
                  onFirstFrame={handleFirstFrame}
                  onAddressChange={handleAddressChange}
                  onNavState={handleNavState}
                  onError={handleBrowserError}
                />
              ) : (
                <iframe
                  key={`${session.url}#${frameNonce}`}
                  src={session.url}
                  title="Viewport preview"
                  className="h-full w-full border-0 bg-background"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                  referrerPolicy="no-referrer"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  onLoad={handleFirstFrame}
                />
              )}
              {browserError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sidebar p-6 text-center">
                  <p className="text-sm font-medium">Browser failed to start</p>
                  <p className="max-w-full break-words text-xs text-muted-foreground">
                    {browserError}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Open with the system browser, or turn the Chromium browser off in Settings →
                    Advanced.
                  </p>
                </div>
              ) : browserLoading ? (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 flex items-center justify-center",
                    reduceTransparency ? "bg-sidebar" : "bg-sidebar/70",
                  )}
                >
                  <Loader2
                    className={cn("size-5 text-muted-foreground", !reduceMotion && "animate-spin")}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <BrowserNewTabEmpty />
          )}
        </div>
      </section>
    </aside>
  );
}
