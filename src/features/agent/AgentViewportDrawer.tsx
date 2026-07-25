import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Channel } from "@tauri-apps/api/core";
import { usePauseableHandler } from "@/lib/idle/hooks";
import { getMotionPolicy } from "@/lib/performance/policy";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FileText,
  Globe2,
  Loader2,
  MoreVertical,
  PanelRightIcon,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IS_LINUX } from "@/lib/utils/platform";
import { useSettingsStore } from "@/store/settingsStore";
import * as native from "./native";
import { AgentReviewContent } from "./AgentReviewPanel";
import { decodeCefFrame, type CefFrame } from "./cefFrame";
import {
  cefCoordinates,
  cefKeyEvents,
  cefModifiers,
  cefWheelDelta,
  type CefInputEvent,
} from "./cefInput";
import {
  moveBrowserHistory,
  pushBrowserHistory,
  resolveBrowserInput,
  type BrowserHistoryState,
} from "./browserNavigation";
import {
  closeViewportBrowser,
  closeViewportReview,
  hideViewportDrawer,
  openEmptyViewport,
  openViewportPreviewUrl,
  openViewportReview,
  useViewportStore,
  VIEWPORT_MAX_WIDTH,
  VIEWPORT_MIN_WIDTH,
  type ViewportTab,
} from "./viewportStore";

type TabDragState = {
  tab: ViewportTab;
  pointerId: number;
  startX: number;
  startCenter: number;
  deltaX: number;
  minX: number;
  maxX: number;
  fromIndex: number;
  previewIndex: number;
  rects: Array<{ tab: ViewportTab; left: number; width: number; center: number }>;
};

export function AgentViewportDrawer() {
  const session = useViewportStore((state) => state.session);
  const review = useViewportStore((state) => state.review);
  const browserOpen = useViewportStore((state) => state.browserOpen);
  const activeTab = useViewportStore((state) => state.activeTab);
  const tabOrder = useViewportStore((state) => state.tabOrder);
  const open = useViewportStore((state) => state.drawerOpen);
  const width = useViewportStore((state) => state.drawerWidth);
  const setActiveTab = useViewportStore((state) => state.actions.setActiveTab);
  const moveTab = useViewportStore((state) => state.actions.moveTab);
  const setDrawerWidth = useViewportStore((state) => state.actions.setDrawerWidth);
  const reduceMotion = useSettingsStore((state) => state.performance.reduceMotion);
  const reduceTransparency = useSettingsStore((state) => state.performance.reduceTransparency);
  const keepViewportActive = useSettingsStore((state) => state.performance.keepViewportActive);
  const experimentalChromiumBrowser = useSettingsStore(
    (state) => state.general.experimentalChromiumBrowser,
  );
  const useChromiumBrowser = IS_LINUX && experimentalChromiumBrowser;
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [frameNonce, setFrameNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(false);
  const handleFirstFrame = useCallback(() => setFrameLoading(false), []);
  const handleAddressChange = useCallback((address: string) => {
    setUrl(address);
    setHistory((state) => pushBrowserHistory(state, address));
  }, []);
  const [frameSuspended, setFrameSuspended] = useState(false);
  const [frameOffloaded, setFrameOffloaded] = useState(false);
  const offloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const OFFLOAD_TIMEOUT_MS = 120_000;
  const [draggingTab, setDraggingTab] = useState<ViewportTab | null>(null);
  const [history, setHistory] = useState<BrowserHistoryState>({ entries: [], index: -1 });
  const historyMoveRef = useRef(false);
  const navRef = useRef<HTMLElement>(null);
  const dragStateRef = useRef<TabDragState | null>(null);
  const tabRefs = useRef<Record<ViewportTab, HTMLDivElement | null>>({ browser: null, review: null });

  useEffect(() => {
    if (open) void native.agentViewportHide().catch(() => undefined);
  }, [open, activeTab]);

  useEffect(() => {
    if (!session?.url) {
      setFrameLoading(false);
      return;
    }
    setUrl(session.url);
    setFrameLoading(true);
    setHistory((state) => {
      if (historyMoveRef.current) {
        historyMoveRef.current = false;
        return state;
      }
      return pushBrowserHistory(state, session.url);
    });
  }, [session?.url]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setDragging(true);

    const onMove = (move: globalThis.PointerEvent) => {
      const next = Math.min(
        VIEWPORT_MAX_WIDTH,
        Math.max(VIEWPORT_MIN_WIDTH, startWidth + startX - move.clientX),
      );
      setDrawerWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const showBrowserTab = browserOpen || Boolean(session);
  const showReviewTab = Boolean(review);
  const visible = Boolean(open && (showBrowserTab || showReviewTab));
  const browserActive = activeTab === "browser";
  const reviewActive = activeTab === "review";
  const browserLoading = Boolean(session?.url && frameLoading);

  useEffect(() => {
    if (keepViewportActive) return;
    if (!visible && (session?.url || browserOpen)) {
      setFrameSuspended(true);
      setFrameOffloaded(false);
      offloadTimerRef.current = setTimeout(() => {
        setFrameOffloaded(true);
      }, OFFLOAD_TIMEOUT_MS);
    } else if (visible && (frameSuspended || frameOffloaded)) {
      if (offloadTimerRef.current) {
        clearTimeout(offloadTimerRef.current);
        offloadTimerRef.current = null;
      }
      setFrameSuspended(false);
      setFrameOffloaded(false);
      if (session?.url) {
        setFrameLoading(true);
        setFrameNonce((n) => n + 1);
      }
    }
    return () => {
      if (offloadTimerRef.current) {
        clearTimeout(offloadTimerRef.current);
        offloadTimerRef.current = null;
      }
    };
  }, [visible, keepViewportActive]);

  usePauseableHandler("viewport-drawer", {
    onPause: () => {
      if (keepViewportActive) return;
      if (!visible && !frameSuspended && (session?.url || browserOpen)) {
        setFrameSuspended(true);
      }
    },
    onResume: () => {
      if (keepViewportActive) return;
      if (visible && (frameSuspended || frameOffloaded)) {
        setFrameSuspended(false);
        setFrameOffloaded(false);
        if (session?.url) {
          setFrameLoading(true);
          setFrameNonce((n) => n + 1);
        }
      }
    },
    priority: 100,
  });

  const openTypedUrl = () => {
    const href = resolveBrowserInput(url);
    if (!href) return;
    openViewportPreviewUrl({
      runId: "user",
      chatId: null,
      url: href,
      reason: null,
      openedBy: "user",
    });
  };

  const moveHistory = (delta: -1 | 1) => {
    const moved = moveBrowserHistory(history, delta);
    if (!moved.url) return;
    historyMoveRef.current = true;
    setHistory(moved.state);
    openViewportPreviewUrl({
      runId: "user",
      chatId: null,
      url: moved.url,
      reason: null,
      openedBy: "user",
    });
  };

  const openExternal = () => {
    const href = session?.url || resolveBrowserInput(url);
    if (!href) return;
    void openUrl(href).catch(() => window.open(href, "_blank", "noopener,noreferrer"));
  };

  const reloadBrowser = () => {
    if (!session?.url) return;
    setFrameLoading(true);
    if (useChromiumBrowser) {
      // Reload in place: remounting would recreate the browser at the stale
      // session URL and lose any in-page navigation.
      void native.cefViewportReload().catch(() => setFrameNonce((nonce) => nonce + 1));
      return;
    }
    setFrameNonce((nonce) => nonce + 1);
  };

  const startTabDrag = (tab: ViewportTab, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-tab-close]")) return;
    event.preventDefault();
    const tabEl = tabRefs.current[tab];
    const navEl = navRef.current;
    if (!tabEl || !navEl) return;
    const tabRect = tabEl.getBoundingClientRect();
    const navRect = navEl.getBoundingClientRect();
    const rects = tabOrder
      .map((item) => {
        const el = tabRefs.current[item];
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { tab: item, left: rect.left, width: rect.width, center: rect.left + rect.width / 2 };
      })
      .filter((item): item is { tab: ViewportTab; left: number; width: number; center: number } => Boolean(item));
    const fromIndex = rects.findIndex((item) => item.tab === tab);
    if (fromIndex < 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      tab,
      pointerId: event.pointerId,
      startX: event.clientX,
      startCenter: tabRect.left + tabRect.width / 2,
      deltaX: 0,
      minX: navRect.left - tabRect.left,
      maxX: navRect.right - tabRect.right,
      fromIndex,
      previewIndex: fromIndex,
      rects,
    };
    setDraggingTab(tab);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const moveDrag = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== pointerId) return;
      moveTabDrag(move);
    };
    const stopDrag = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      finishTabDrag(pointerId, target, up.type !== "pointercancel");
    };
    window.addEventListener("pointermove", moveDrag, { passive: false });
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  };

  const moveTabDrag = (event: globalThis.PointerEvent) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    state.deltaX = Math.min(state.maxX, Math.max(state.minX, event.clientX - state.startX));
    state.previewIndex = getPreviewTabIndex(state);
    applyTabDragTransforms(state);
  };

  const finishTabDrag = (pointerId: number, targetEl: HTMLElement, commit: boolean) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== pointerId) return;
    if (targetEl.hasPointerCapture(pointerId)) {
      targetEl.releasePointerCapture(pointerId);
    }
    dragStateRef.current = null;
    setDraggingTab(null);
    const isClick = Math.abs(state.deltaX) < 5;
    if (isClick && commit) {
      setActiveTab(state.tab);
      resetTabDragTransforms();
      return;
    }
    const target = state.rects[state.previewIndex];
    if (commit && target && state.previewIndex !== state.fromIndex) {
      moveTab(state.tab, target.tab, state.previewIndex < state.fromIndex ? "before" : "after");
      requestAnimationFrame(resetTabDragTransforms);
    } else {
      resetTabDragTransforms();
    }
  };

  const getPreviewTabIndex = (state: TabDragState) => {
    const draggedCenter = state.startCenter + state.deltaX;
    let previewIndex = state.fromIndex;
    state.rects.forEach((rect, index) => {
      if (index > state.fromIndex && draggedCenter > rect.center) previewIndex = index;
      if (index < state.fromIndex && draggedCenter < rect.center) previewIndex = index;
    });
    return previewIndex;
  };

  const applyTabDragTransforms = (state: TabDragState) => {
    const rects = state.rects;
    rects.forEach((rect, index) => {
      const el = tabRefs.current[rect.tab];
      if (!el) return;
      el.style.transition = "none";
      if (rect.tab === state.tab) {
        el.style.transform = `translate3d(${state.deltaX}px, 0, 0)`;
        return;
      }
      let offset = 0;
      if (state.previewIndex > state.fromIndex && index > state.fromIndex && index <= state.previewIndex) {
        offset = rects[index - 1].left - rect.left;
      }
      if (state.previewIndex < state.fromIndex && index >= state.previewIndex && index < state.fromIndex) {
        offset = rects[index + 1].left - rect.left;
      }
      el.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : "";
    });
  };

  const resetTabDragTransforms = () => {
    Object.values(tabRefs.current).forEach((el) => {
      if (!el) return;
      el.style.transform = "";
      el.style.transition = "";
    });
  };

  return (
    <aside
      aria-label="Agent viewport"
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
        aria-label="Resize agent viewport"
        onPointerDown={startResize}
      />
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3">
        <nav ref={navRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {tabOrder.map((tab) => {
            if (tab === "review" && showReviewTab) {
              return (
                <DrawerTab
                  key="review"
                  tab="review"
                  tabRef={(node) => {
                    tabRefs.current.review = node;
                  }}
                  active={reviewActive}
                  icon={<FileText />}
                  label="Summary"
                  onClick={() => setActiveTab("review")}
                  onClose={closeViewportReview}
                  isDragging={draggingTab === "review"}
                  onPointerDown={startTabDrag}
                />
              );
            }
            if (tab === "browser" && showBrowserTab) {
              return (
                <DrawerTab
                  key="browser"
                  tab="browser"
                  tabRef={(node) => {
                    tabRefs.current.browser = node;
                  }}
                  active={browserActive}
                  icon={<Globe2 />}
                  label={browserTabLabel(session?.label || session?.url)}
                  onClick={() => setActiveTab("browser")}
                  onClose={closeViewportBrowser}
                  isDragging={draggingTab === "browser"}
                  onPointerDown={startTabDrag}
                />
              );
            }
            return null;
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="small" aria-label="Add viewport tab" title="Add tab">
                <Plus size={15} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={openEmptyViewport}>
                <Globe2 />
                Browser
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openViewportReview(review ?? { fallbackFiles: [], toolCalls: {} })}>
                <FileText />
                Review / summary
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        {browserActive && browserLoading ? (
          <Loader2 className={cn("size-4 shrink-0 text-muted-foreground", !reduceMotion && "animate-spin")} />
        ) : null}
        <IconButton
          size="small"
          aria-label="Hide viewport"
          title="Hide viewport"
          onClick={hideViewportDrawer}
        >
          <PanelRightIcon className="-scale-x-100" size={15} />
        </IconButton>
      </header>
      {browserActive ? (
        <section className="flex min-h-0 flex-1 flex-col bg-sidebar">
          <div className="grid h-14 shrink-0 grid-cols-[104px_minmax(0,1fr)_32px] items-center gap-3 border-b border-sidebar-border px-4">
            <div className="flex items-center gap-1">
              <IconButton
                size="small"
                aria-label="Back"
                title="Back"
                disabled={history.index <= 0}
                onClick={() => moveHistory(-1)}
                className="text-muted-foreground"
              >
                <ArrowLeft size={18} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Forward"
                title="Forward"
                disabled={history.index >= history.entries.length - 1}
                onClick={() => moveHistory(1)}
                className="text-muted-foreground"
              >
                <ArrowRight size={18} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Reload preview"
                title="Reload preview"
                onClick={reloadBrowser}
                disabled={!session?.url}
                className="text-muted-foreground"
              >
                <RotateCw size={15} />
              </IconButton>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                openTypedUrl();
              }}
              className="relative h-10 w-full min-w-0 max-w-[720px] justify-self-center"
            >
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Enter a URL"
                spellCheck={false}
                autoComplete="off"
                className="h-10 rounded-[18px] border border-transparent bg-transparent px-5 pr-11 text-center text-[15px] text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:bg-sidebar-accent focus:bg-transparent focus:text-left focus-visible:border-ring focus-visible:ring-0"
              />
              <button
                type="submit"
                aria-label="Open page or search"
                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <ExternalLink size={16} />
              </button>
            </form>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="small" aria-label="More browser actions" title="More">
                  <MoreVertical size={18} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem disabled={!session?.url && !url.trim()} onSelect={openExternal}>
                  <ExternalLink />
                  Open in external browser
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative min-h-0 flex-1 bg-sidebar">
            {session?.url ? (
              <>
                {frameOffloaded || frameSuspended ? (
                  <BrowserNewTabEmpty />
                ) : (
                  useChromiumBrowser ? (
                    <CefViewport
                      key={`${session.url}#${frameNonce}`}
                      url={session.url}
                      onFirstFrame={handleFirstFrame}
                      onAddressChange={handleAddressChange}
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
                  )
                )}
                {browserLoading && !frameSuspended ? (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 flex items-center justify-center",
                      reduceTransparency ? "bg-sidebar" : "bg-sidebar/70",
                    )}
                  >
                    <Loader2 className={cn("size-5 text-muted-foreground", !reduceMotion && "animate-spin")} />
                  </div>
                ) : null}
              </>
            ) : (
              <BrowserNewTabEmpty />
            )}
          </div>
        </section>
      ) : (
        <section className="min-h-0 flex-1 bg-background">
          {review ? (
            <AgentReviewContent
              active={reviewActive}
              workspacePath={review.workspacePath}
              initialPath={review.initialPath}
              fallbackFiles={review.fallbackFiles}
              toolCalls={review.toolCalls}
              onClose={hideViewportDrawer}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No review summary for this run yet.
            </div>
          )}
        </section>
      )}
    </aside>
  );
}

function CefViewport({
  url,
  onFirstFrame,
  onAddressChange,
}: {
  url: string;
  onFirstFrame: () => void;
  onAddressChange: (url: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerAnimationRef = useRef(0);
  const pendingMoveRef = useRef<CefInputEvent | null>(null);
  const pendingWheelRef = useRef<CefInputEvent | null>(null);
  const wheelStartedAtRef = useRef<number | null>(null);

  function sendInput(...events: CefInputEvent[]) {
    if (events.length) void native.cefViewportInput(events).catch(() => undefined);
  }

  function mouseInput(event: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { x, y } = cefCoordinates(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
    );
    return {
      x,
      y,
      modifiers: cefModifiers({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        buttons: event.buttons,
        capsLock: event.getModifierState("CapsLock"),
        numLock: event.getModifierState("NumLock"),
      }),
    };
  }

  function flushPointerInput() {
    if (pointerAnimationRef.current) cancelAnimationFrame(pointerAnimationRef.current);
    pointerAnimationRef.current = 0;
    sendInput(...[pendingMoveRef.current, pendingWheelRef.current].filter((event): event is CefInputEvent => event !== null));
    pendingMoveRef.current = null;
    pendingWheelRef.current = null;
  }

  function schedulePointerFlush() {
    if (!pointerAnimationRef.current) {
      pointerAnimationRef.current = requestAnimationFrame(flushPointerInput);
    }
  }

  function queueMouseMove(event: ReactMouseEvent<HTMLCanvasElement>) {
    const input = mouseInput(event);
    if (!input) return;
    pendingMoveRef.current = { kind: "mouse_move", ...input, mouseLeave: false };
    schedulePointerFlush();
  }

  function queueMouseLeave(event: ReactMouseEvent<HTMLCanvasElement>) {
    const input = mouseInput(event);
    if (!input) return;
    pendingMoveRef.current = { kind: "mouse_move", ...input, mouseLeave: true };
    schedulePointerFlush();
  }

  function queueWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.stopPropagation();
    const input = mouseInput(event);
    if (!input) return;
    const delta = cefWheelDelta(event.deltaX, event.deltaY, event.deltaMode, event.currentTarget.clientHeight);
    const pending = pendingWheelRef.current;
    pendingWheelRef.current = {
      kind: "mouse_wheel",
      ...input,
      deltaX: delta.deltaX + (pending?.kind === "mouse_wheel" ? pending.deltaX : 0),
      deltaY: delta.deltaY + (pending?.kind === "mouse_wheel" ? pending.deltaY : 0),
    };
    wheelStartedAtRef.current ??= performance.now();
    schedulePointerFlush();
  }

  function sendMouseClick(event: ReactMouseEvent<HTMLCanvasElement>, mouseUp: boolean) {
    event.preventDefault();
    event.stopPropagation();
    if (!mouseUp) event.currentTarget.focus({ preventScroll: true });
    const input = mouseInput(event);
    if (!input || event.button > 2) return;
    flushPointerInput();
    sendInput({
      kind: "mouse_click",
      ...input,
      button: event.button === 1 ? "middle" : event.button === 2 ? "right" : "left",
      mouseUp,
      clickCount: Math.max(1, Math.min(3, event.detail || 1)),
    });
  }

  function sendKey(event: ReactKeyboardEvent<HTMLCanvasElement>, phase: "down" | "up") {
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    sendInput(...cefKeyEvents({
      key: event.key,
      keyCode: event.keyCode,
      location: event.location,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      capsLock: event.getModifierState("CapsLock"),
      numLock: event.getModifierState("NumLock"),
    }, phase));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let opened = false;
    let disposed = false;
    let pendingFrame: CefFrame | null = null;
    let paintAnimationFrame = 0;
    const frames = new Channel<ArrayBuffer>();
    const cursors = new Channel<string>();
    cursors.onmessage = (cursor) => {
      canvas.style.cursor = cursor;
    };
    const addresses = new Channel<string>();
    addresses.onmessage = (address) => {
      if (!disposed) onAddressChange(address);
    };
    const present = () => {
      paintAnimationFrame = 0;
      const frame = pendingFrame;
      pendingFrame = null;
      if (!frame || disposed) return;
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      frame.rects.forEach((rect) => {
        context.putImageData(new ImageData(rect.pixels, rect.width, rect.height), rect.x, rect.y);
      });
      canvas.dataset.frameLatencyMs = (Date.now() - frame.paintedAtMs).toFixed(1);
      if (wheelStartedAtRef.current !== null) {
        canvas.dataset.scrollInputLatencyMs = (performance.now() - wheelStartedAtRef.current).toFixed(1);
        wheelStartedAtRef.current = null;
      }
      onFirstFrame();
      if (pendingFrame) paintAnimationFrame = requestAnimationFrame(present);
    };
    frames.onmessage = (packet) => {
      try {
        pendingFrame = decodeCefFrame(packet);
        if (!paintAnimationFrame) paintAnimationFrame = requestAnimationFrame(present);
      } catch (error) {
        console.warn("Invalid CEF frame:", error);
      }
    };

    let lastSize = "";
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.round(bounds.width);
      const height = Math.round(bounds.height);
      const scaleFactor = window.devicePixelRatio || 1;
      const size = `${width}x${height}@${scaleFactor}`;
      if (width <= 0 || height <= 0 || size === lastSize) return;
      lastSize = size;
      if (!opened) {
        opened = true;
        void native.cefViewportOpen({ url, width, height, scaleFactor, onFrame: frames, onCursor: cursors, onAddress: addresses }).catch((error) => {
          opened = false;
          console.error("Failed to open CEF viewport:", error);
        });
      } else {
        void native.cefViewportResize(width, height, scaleFactor).catch((error) => {
          console.warn("Failed to resize CEF viewport:", error);
        });
      }
    };
    // Coalesce to the trailing edge: a sidebar collapse resizes this canvas on
    // every frame, and each one would otherwise fire a getBoundingClientRect
    // plus a cef_viewport_resize invoke into the native renderer.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const scheduleResize = () => {
      clearTimeout(settle);
      settle = setTimeout(resize, getMotionPolicy().transitionDurationMs);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(canvas);

    return () => {
      disposed = true;
      clearTimeout(settle);
      observer.disconnect();
      if (paintAnimationFrame) cancelAnimationFrame(paintAnimationFrame);
      if (pointerAnimationRef.current) cancelAnimationFrame(pointerAnimationRef.current);
      if (opened) void native.cefViewportClose().catch(() => undefined);
    };
  }, [url, onFirstFrame, onAddressChange]);

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label="CEF browser viewport"
      className="block h-full w-full bg-background outline-none"
      onFocus={() => sendInput({ kind: "focus", focused: true })}
      onBlur={() => sendInput({ kind: "focus", focused: false })}
      onMouseMove={queueMouseMove}
      onMouseLeave={queueMouseLeave}
      onMouseDown={(event) => sendMouseClick(event, false)}
      onMouseUp={(event) => sendMouseClick(event, true)}
      onWheel={queueWheel}
      onKeyDown={(event) => sendKey(event, "down")}
      onKeyUp={(event) => sendKey(event, "up")}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}

function BrowserNewTabEmpty() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="-mt-10 flex flex-col items-center">
        <Globe2 className="mb-8 size-20 text-muted-foreground" strokeWidth={1.7} />
        <div className="text-lg font-medium text-foreground">Start browsing</div>
        <div className="mt-3 text-base text-muted-foreground">Enter a URL or search with Google</div>
      </div>
    </div>
  );
}

function DrawerTab({
  active,
  icon,
  isDragging,
  label,
  onClose,
  onClick,
  onPointerDown,
  tab,
  tabRef,
}: {
  active: boolean;
  icon: React.ReactNode;
  isDragging?: boolean;
  label: string;
  onClose?: () => void;
  onClick: () => void;
  onPointerDown: (tab: ViewportTab, event: ReactPointerEvent<HTMLElement>) => void;
  tab: ViewportTab;
  tabRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={tabRef}
      onPointerDown={(event) => onPointerDown(tab, event)}
      style={{ touchAction: "none" }}
      className={cn(
        "group inline-flex h-8 min-w-0 cursor-grab select-none items-center rounded-2xl text-sm font-medium shadow-sm transition-colors will-change-transform active:cursor-grabbing",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        isDragging && "relative z-10 shadow-lg",
        "[&_svg]:size-4",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-2xl pl-3 pr-1"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          data-tab-close
          aria-label={`Close ${label} tab`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="mr-1 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground opacity-70 hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

function browserTabLabel(value?: string | null) {
  if (!value) return "New tab";
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return value.length > 22 ? `${value.slice(0, 22)}...` : value;
  }
}
