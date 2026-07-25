import { useRef } from "react";
import { useCefCanvasInput } from "../hooks/useCefCanvasInput";
import { useCefSurface } from "../hooks/useCefSurface";

/**
 * A Chromium page rendered offscreen and drawn into a normal DOM canvas, so
 * app overlays can still composite above it. Remount (via `key`) to navigate;
 * the surface hook opens one native browser per mount.
 */
export function CefViewport({
  url,
  onFirstFrame,
  onAddressChange,
}: {
  url: string;
  onFirstFrame: () => void;
  onAddressChange: (url: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { handlers, takeScrollLatencyMs } = useCefCanvasInput(canvasRef);

  useCefSurface({ canvasRef, url, onFirstFrame, onAddressChange, takeScrollLatencyMs });

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
