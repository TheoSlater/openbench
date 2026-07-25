import { useEffect, type RefObject } from "react";
import { Channel } from "@tauri-apps/api/core";
import { getMotionPolicy } from "@/lib/performance/policy";
import * as native from "../native";
import { decodeCefFrame, type CefFrame } from "../cefFrame";

type CefSurfaceOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  url: string;
  onFirstFrame: () => void;
  onAddressChange: (url: string) => void;
  takeScrollLatencyMs: () => number | null;
};

/**
 * Owns the native browser for as long as the canvas is mounted: opens it at
 * the first known size, keeps it sized to the canvas, paints incoming frames,
 * and closes it on unmount.
 */
export function useCefSurface({
  canvasRef,
  url,
  onFirstFrame,
  onAddressChange,
  takeScrollLatencyMs,
}: CefSurfaceOptions) {
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
    const addresses = new Channel<string>();
    cursors.onmessage = (cursor) => {
      canvas.style.cursor = cursor;
    };
    addresses.onmessage = (address) => {
      if (!disposed) onAddressChange(address);
    };

    // Paint at most once per animation frame, dropping any frame superseded
    // before it was drawn.
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
      const scrollLatencyMs = takeScrollLatencyMs();
      if (scrollLatencyMs !== null) {
        canvas.dataset.scrollInputLatencyMs = scrollLatencyMs.toFixed(1);
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
        void native
          .cefViewportOpen({
            url,
            width,
            height,
            scaleFactor,
            onFrame: frames,
            onCursor: cursors,
            onAddress: addresses,
          })
          .catch((error) => {
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
    const observer = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(resize, getMotionPolicy().transitionDurationMs);
    });
    observer.observe(canvas);

    return () => {
      disposed = true;
      clearTimeout(settle);
      observer.disconnect();
      if (paintAnimationFrame) cancelAnimationFrame(paintAnimationFrame);
      if (opened) void native.cefViewportClose().catch(() => undefined);
    };
  }, [canvasRef, url, onFirstFrame, onAddressChange, takeScrollLatencyMs]);
}
