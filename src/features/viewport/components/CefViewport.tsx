import { useRef } from "react";
import { useCefCanvasInput } from "../hooks/useCefCanvasInput";
import { useCefSurface } from "../hooks/useCefSurface";
import type { CefNavState } from "../native";

/**
 * A Chromium page rendered offscreen and drawn into a normal DOM canvas, so
 * app overlays can still composite above it.
 *
 * One native browser per mount, and `initialUrl` is only the page it starts
 * on: navigate with `cefViewportNavigate` rather than remounting, or Chromium
 * loses the session history that back/forward walk.
 */
export function CefViewport({
  browserId,
  initialUrl,
  onFirstFrame,
  onAddressChange,
  onNavState,
  onError,
}: {
  browserId: number;
  initialUrl: string;
  onFirstFrame: () => void;
  onAddressChange: (url: string) => void;
  onNavState: (state: CefNavState) => void;
  onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { handlers, takeScrollLatencyMs } = useCefCanvasInput(canvasRef, browserId);

  useCefSurface({
    canvasRef,
    browserId,
    initialUrl,
    onFirstFrame,
    onAddressChange,
    onNavState,
    onError,
    takeScrollLatencyMs,
  });

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label="CEF browser viewport"
      className="block h-full w-full bg-background outline-none"
      {...handlers}
    />
  );
}
