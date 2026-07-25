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
  Globe2,
  Loader2,
  MoreVertical,
  PanelRightIcon,
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
  hideViewportDrawer,
  openViewportPreviewUrl,
  useViewportStore,
  VIEWPORT_MAX_WIDTH,
  VIEWPORT_MIN_WIDTH,
} from "./viewportStore";

export function ViewportDrawer() {
  const session = useViewportStore((state) => state.session);
  const browserOpen = useViewportStore((state) => state.browserOpen);
  const open = useViewportStore((state) => state.drawerOpen);
  const width = useViewportStore((state) => state.drawerWidth);
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
  const [history, setHistory] = useState<BrowserHistoryState>({ entries: [], index: -1 });
  const historyMoveRef = useRef(false);

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

  const visible = Boolean(open && (browserOpen || session));
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
      chatId: null,
      url: href,
      openedBy: "user",
    });
  };

  const moveHistory = (delta: -1 | 1) => {
    const moved = moveBrowserHistory(history, delta);
    if (!moved.url) return;
    historyMoveRef.current = true;
    setHistory(moved.state);
    openViewportPreviewUrl({
      chatId: null,
      url: moved.url,
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
  icon,
  label,
  onClose,
}: {
  icon: React.ReactNode;
  label: string;
  onClose?: () => void;
}) {
  return (
    <div
      className="group inline-flex h-8 min-w-0 items-center rounded-2xl bg-sidebar-accent text-sm font-medium text-foreground shadow-sm [&_svg]:size-4"
    >
      <span className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-2xl pl-3 pr-1">
        {icon}
        <span className="truncate">{label}</span>
      </span>
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
