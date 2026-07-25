import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { VIEWPORT_MAX_WIDTH, VIEWPORT_MIN_WIDTH } from "../viewportStore";

/** Drag-to-resize for the drawer's left edge. Drags right-to-left to widen. */
export function useDrawerResize(width: number, setWidth: (width: number) => void) {
  const [dragging, setDragging] = useState(false);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);

    const onMove = (move: globalThis.PointerEvent) => {
      setWidth(
        Math.min(VIEWPORT_MAX_WIDTH, Math.max(VIEWPORT_MIN_WIDTH, startWidth + startX - move.clientX)),
      );
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return { dragging, startResize };
}
