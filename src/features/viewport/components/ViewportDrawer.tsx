import { useCallback, useEffect, useRef, useState } from "react";
import { Reorder } from "motion/react";
import {
  Globe2,
  Loader2,
  PanelRightIcon,
  Plus,
  SquareTerminal,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { SUPPORTS_CHROMIUM_BROWSER } from "@/lib/utils/platform";
import { useSettingsStore } from "@/store/settingsStore";
import * as native from "../native";
import type { CefNavState } from "../native";
import {
  moveBrowserHistory,
  pushBrowserHistory,
  resolveBrowserInput,
  type BrowserHistoryState,
} from "../browserNavigation";
import {
  closeViewportTab,
  closeViewportTabs,
  hideViewportDrawer,
  openEmptyViewport,
  openViewportTerminal,
  selectViewportTab,
  setViewportTabOrder,
  updateViewportBrowserUrl,
  useViewportStore,
  type ViewportTab,
} from "../viewportStore";
import { useDrawerResize } from "../hooks/useDrawerResize";
import { useViewportSuspension } from "../hooks/useViewportSuspension";
import { BrowserNewTabEmpty } from "./BrowserNewTabEmpty";
import { BrowserToolbar } from "./BrowserToolbar";
import { CefViewport } from "./CefViewport";
import { allocateBrowserId } from "../hooks/useCefSurface";
import { browserTabLabel, DrawerTab } from "./DrawerTab";
import { TerminalViewport } from "./TerminalViewport";

export function ViewportDrawer() {
  const tabs = useViewportStore((state) => state.tabs);
  const activeTabId = useViewportStore((state) => state.activeTabId);
  const open = useViewportStore((state) => state.drawerOpen);
  const width = useViewportStore((state) => state.drawerWidth);
  const setDrawerWidth = useViewportStore((state) => state.actions.setDrawerWidth);
  const betaFeatures = useSettingsStore((state) => state.general.betaFeatures);
  const reduceMotion = useReducedMotion();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const { dragging, startResize } = useDrawerResize(width, setDrawerWidth);
  const visible = open && tabs.length > 0;
  const hasTerminalTabs = tabs.some((tab) => tab.type === "terminal");

  useEffect(() => {
    if (!betaFeatures && hasTerminalTabs) closeViewportTabs("terminal");
  }, [betaFeatures, hasTerminalTabs]);

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
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Reorder.Group
            as="div"
            axis="x"
            values={tabs.map((tab) => tab.id)}
            onReorder={setViewportTabOrder}
            className="flex items-center gap-1.5"
          >
            {tabs.map((tab) => (
              <DrawerTab
                key={tab.id}
                id={tab.id}
                icon={tab.type === "browser" ? <Globe2 /> : <SquareTerminal />}
                label={
                  tab.type === "browser"
                    ? browserTabLabel(tab.session?.label || tab.session?.url)
                    : "Terminal"
                }
                active={activeTabId === tab.id}
                dragging={draggedTabId === tab.id}
                reduceMotion={reduceMotion}
                onSelect={() => selectViewportTab(tab.id)}
                onClose={() => closeViewportTab(tab.id)}
                onDragStart={() => setDraggedTabId(tab.id)}
                onDragEnd={() => setDraggedTabId(null)}
              />
            ))}
          </Reorder.Group>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="small"
                className="shrink-0"
                aria-label="Add viewport tab"
                title="Add tab"
              >
                <Plus size={16} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={openEmptyViewport}>
                <Globe2 />
                Browser
              </DropdownMenuItem>
              {betaFeatures ? (
                <DropdownMenuItem onSelect={openViewportTerminal}>
                  <SquareTerminal />
                  Terminal (Beta)
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <IconButton
          size="small"
          aria-label="Hide viewport"
          title="Hide viewport"
          onClick={hideViewportDrawer}
        >
          <PanelRightIcon className="-scale-x-100" size={16} />
        </IconButton>
      </header>
      {tabs.map((tab) =>
        tab.type === "browser" ? (
          <BrowserViewport
            key={tab.id}
            tab={tab}
            active={activeTabId === tab.id}
          />
        ) : (
          <section
            key={tab.id}
            className={cn(
              "min-h-0 flex-1 bg-sidebar",
              activeTabId === tab.id ? "block" : "hidden",
            )}
          >
            <TerminalViewport />
          </section>
        ),
      )}
    </aside>
  );
}

function BrowserViewport({
  tab,
  active,
}: {
  tab: ViewportTab;
  active: boolean;
}) {
  const session = tab.session;
  const reduceMotion = useReducedMotion();
  const reduceTransparency = useSettingsStore(
    (state) => state.performance.reduceTransparency,
  );
  const experimentalChromiumBrowser = useSettingsStore(
    (state) => state.general.experimentalChromiumBrowser,
  );
  const experimentalFeatures = useSettingsStore(
    (state) => state.general.experimentalFeatures,
  );
  const useChromiumBrowser =
    SUPPORTS_CHROMIUM_BROWSER &&
    experimentalFeatures &&
    experimentalChromiumBrowser;
  const [url, setUrl] = useState(session?.url ?? "");
  const [frameNonce, setFrameNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(Boolean(session?.url));
  const [browserError, setBrowserError] = useState("");
  // Chromium owns history on the CEF path; the iframe path cannot read a
  // cross-origin frame's history, so it keeps its own list and re-mounts.
  const [navState, setNavState] = useState<CefNavState>({
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [history, setHistory] = useState<BrowserHistoryState>({
    entries: [],
    index: -1,
  });
  const historyMoveRef = useRef(false);
  // The page Chromium reports it is showing. Guards the navigate effect below
  // against echoing its own address changes back as fresh navigations.
  const cefUrlRef = useRef(session?.url ?? "");
  // One browser per tab, named for the helper process that hosts them all.
  // Stable across a frameNonce remount: the same tab keeps the same browser.
  const browserIdRef = useRef(0);
  if (!browserIdRef.current) browserIdRef.current = allocateBrowserId();
  const browserId = browserIdRef.current;

  const remountBrowser = useCallback(() => {
    setBrowserError("");
    setFrameLoading(true);
    setFrameNonce((nonce) => nonce + 1);
  }, []);
  const { suspended, offloaded } = useViewportSuspension({
    visible: active,
    hasContent: Boolean(session?.url),
    onWake: () => {
      if (session?.url) remountBrowser();
    },
  });

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
        void native.cefViewportNavigate(browserId, session.url).catch(remountBrowser);
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

  const handleAddressChange = useCallback(
    (address: string) => {
      setUrl(address);
      // Record what Chromium moved to before it lands in the store, so the
      // navigate effect does not read it back as a new destination.
      cefUrlRef.current = address;
      updateViewportBrowserUrl(tab.id, address);
    },
    [tab.id],
  );

  const handleNavState = useCallback((state: CefNavState) => {
    setNavState(state);
    if (state.isLoading) setFrameLoading(true);
  }, []);

  const handleFirstFrame = useCallback(() => {
    setBrowserError("");
    setFrameLoading(false);
  }, []);

  const handleBrowserError = useCallback((message: string) => setBrowserError(message), []);

  const openTypedUrl = () => {
    const href = resolveBrowserInput(url);
    if (href) updateViewportBrowserUrl(tab.id, href);
  };

  const moveHistory = (delta: -1 | 1) => {
    if (useChromiumBrowser) {
      const go = delta === -1 ? native.cefViewportBack : native.cefViewportForward;
      void go(browserId).catch(() => undefined);
      return;
    }
    const moved = moveBrowserHistory(history, delta);
    if (!moved.url) return;
    historyMoveRef.current = true;
    setHistory(moved.state);
    updateViewportBrowserUrl(tab.id, moved.url);
  };

  const openExternal = () => {
    const href = session?.url || resolveBrowserInput(url);
    if (!href) return;
    void openUrl(href).catch(() =>
      window.open(href, "_blank", "noopener,noreferrer"),
    );
  };

  const reloadBrowser = () => {
    if (!session?.url) return;
    if (useChromiumBrowser) {
      setFrameLoading(true);
      void native.cefViewportReload(browserId).catch(remountBrowser);
      return;
    }
    remountBrowser();
  };

  return (
    <section
      className={cn(
        "min-h-0 flex-1 flex-col bg-sidebar",
        active ? "flex" : "hidden",
      )}
    >
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
        {session?.url &&
        !suspended &&
        !offloaded &&
        (!useChromiumBrowser || active) ? (
          <>
            {useChromiumBrowser ? (
              <CefViewport
                // Keyed on the tab, not the URL: one browser per tab for its
                // whole life, so navigating never rebuilds Chromium.
                key={`${tab.id}#${frameNonce}`}
                browserId={browserId}
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
                title={browserTabLabel(session.label)}
                className="h-full w-full border-0 bg-background"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write; fullscreen"
                onLoad={() => setFrameLoading(false)}
              />
            )}
            {browserError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sidebar p-6 text-center">
                <p className="text-sm font-medium">Browser failed to start</p>
                <p className="max-w-full break-words text-xs text-muted-foreground">
                  {browserError}
                </p>
                <p className="text-xs text-muted-foreground">
                  Open with the system browser, or turn the Chromium browser off in
                  Settings → Advanced.
                </p>
              </div>
            ) : frameLoading ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center justify-center",
                  reduceTransparency ? "bg-sidebar" : "bg-sidebar/70",
                )}
              >
                <Loader2
                  className={cn(
                    "size-5 text-muted-foreground",
                    !reduceMotion && "animate-spin",
                  )}
                />
              </div>
            ) : null}
          </>
        ) : (
          <BrowserNewTabEmpty />
        )}
      </div>
    </section>
  );
}
