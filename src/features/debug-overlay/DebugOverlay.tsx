import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen } from "@/lib/tauriBridge";
import { useShallow } from "zustand/react/shallow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDevStore } from "@/store/devStore";
import { applyRuntimeEvent } from "./apiCalls";
import { devLog } from "./devLog";
import type {
  ApiCallEntry,
  DebugOverlayRuntimeEvent,
  DebugStats,
  OverlayPosition,
} from "./types";

const POSITION_CLASSES: Record<OverlayPosition, string> = {
  "top-left": "left-3 top-3",
  "top-right": "right-3 top-3",
  "bottom-left": "bottom-3 left-3",
  "bottom-right": "bottom-3 right-3",
};

const POSITION_OPTIONS: { value: OverlayPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

const OVERLAY_CARD_BASE_CLASS = [
  "fixed z-[9999] w-60 select-none rounded-xl border border-border/60 bg-card/90",
  "p-2.5 font-mono text-xs leading-relaxed text-foreground shadow-xl backdrop-blur",
].join(" ");

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.round(mb)}M`;
}

function formatDuration(call: ApiCallEntry): string {
  if (call.finishedAt === undefined) {
    return call.chunkCount > 0 ? `${call.chunkCount}ch` : "waiting";
  }
  return `${((call.finishedAt - call.startedAt) / 1000).toFixed(1)}s`;
}

function useFrontendFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export function DebugOverlay() {
  const { position } = useDevStore(
    useShallow((state) => ({
      position: state.debugOverlay.position,
    })),
  );
  const setDebugOverlay = useDevStore((state) => state.actions.setDebugOverlay);
  const [stats, setStats] = useState<DebugStats | null>(null);
  const [calls, setCalls] = useState<ApiCallEntry[]>([]);
  const fps = useFrontendFps();
  const lastStatsLog = useRef(0);

  useEffect(() => {
    void invoke("debug_overlay_enable", { enabled: true }).catch(() => undefined);
    devLog("info", "overlay", "debug overlay mounted");
    return () => {
      void invoke("debug_overlay_enable", { enabled: false }).catch(() => undefined);
      devLog("info", "overlay", "debug overlay unmounted");
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<DebugStats>("debug-overlay-stats", (event) => {
      setStats(event.payload);
      const now = performance.now();
      if (now - lastStatsLog.current >= 1000) {
        lastStatsLog.current = now;
        devLog("info", "overlay", "stats", event.payload);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<DebugOverlayRuntimeEvent>("ai-runtime-event", (event) => {
      setCalls((previous) => {
        const next = applyRuntimeEvent(previous, event.payload);
        if (next === previous) return previous;
        const head = next[0];
        const previousHead = previous[0];
        if (!previousHead || previousHead.requestId !== head.requestId) {
          devLog("info", "api", `request ${head.status}`, {
            requestId: head.requestId,
            error: head.error ?? undefined,
          });
        } else if (previousHead.status !== head.status) {
          devLog("info", "api", `request ${head.status}`, {
            requestId: head.requestId,
            error: head.error ?? undefined,
          });
        }
        return next;
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handlePositionChange = useCallback(
    (value: OverlayPosition | null) => {
      if (!value) return;
      const next = value;
      setDebugOverlay({ position: next });
      devLog("info", "overlay", `position ${position} -> ${next}`);
    },
    [position, setDebugOverlay],
  );

  const cpu = stats ? `${stats.cpuPercent.toFixed(1)}%` : "—";
  const mem = stats
    ? `${formatMb(stats.memUsedMb)} / ${formatMb(stats.memTotalMb)}`
    : "—";
  const appMem = stats ? formatMb(stats.appMemMb) : "—";

  return (
    <div
      className={`${OVERLAY_CARD_BASE_CLASS} ${POSITION_CLASSES[position]}`}
      data-testid="debug-overlay"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">
          DEV
        </span>
        <Select value={position} onValueChange={handlePositionChange}>
          <SelectTrigger
            size="sm"
            aria-label="Debug overlay position"
            className="h-5 rounded border border-border/60 bg-background/50 px-1.5 py-0 text-[10px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POSITION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
        <div className="flex justify-between">
          <span className="text-muted-foreground">frontend</span>
          <span>{fps}fps</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">cpu</span>
          <span>{cpu}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">ram</span>
          <span>{mem}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">app</span>
          <span>{appMem}</span>
        </div>
      </div>

      <div className="mt-1.5 border-t border-border/60 pt-1">
        <div className="text-[9px] tracking-wider text-muted-foreground">
          API CALLS
        </div>
        {calls.length === 0 ? (
          <div className="text-muted-foreground/50">none</div>
        ) : (
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {calls.slice(0, 5).map((call) => (
              <li
                key={call.requestId}
                className="flex items-center justify-between gap-1"
              >
                <span className="flex min-w-0 items-center gap-1">
                  <span
                    className={
                      call.status === "success"
                        ? "text-emerald-500"
                        : call.status === "error"
                          ? "text-red-500"
                          : "text-yellow-500"
                    }
                  >
                    {call.status === "success" ? "✓" : call.status === "error" ? "✗" : "…"}
                  </span>
                  <span className="truncate text-foreground/70">
                    {call.requestId.slice(0, 8)}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatDuration(call)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
