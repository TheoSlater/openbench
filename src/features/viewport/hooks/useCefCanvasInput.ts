import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import * as native from "../native";
import {
  cefCoordinates,
  cefKeyEvents,
  cefModifiers,
  cefWheelDelta,
  type CefInputEvent,
} from "../cefInput";

/** Props to spread onto the viewport `<canvas>`. */
export type CefCanvasInputHandlers = {
  onFocus: () => void;
  onBlur: () => void;
  onMouseMove: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLCanvasElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLCanvasElement>) => void;
};

/**
 * Translates DOM events on the canvas into CEF input events.
 *
 * Moves and wheels are coalesced onto one animation frame — a trackpad emits
 * far more of them than the browser can consume, and each one is an IPC hop.
 * Clicks and keys flush immediately so ordering against a pending move holds.
 */
export function useCefCanvasInput(canvasRef: RefObject<HTMLCanvasElement | null>): {
  handlers: CefCanvasInputHandlers;
  /** Time since the wheel event that triggered the frame being painted, once. */
  takeScrollLatencyMs: () => number | null;
} {
  const animationFrameRef = useRef(0);
  const pendingMoveRef = useRef<CefInputEvent | null>(null);
  const pendingWheelRef = useRef<CefInputEvent | null>(null);
  const wheelStartedAtRef = useRef<number | null>(null);

  const handlers = useMemo<CefCanvasInputHandlers>(() => {
    function sendInput(...events: CefInputEvent[]) {
      if (events.length) void native.cefViewportInput(events).catch(() => undefined);
    }

    /** Canvas-space coordinates and modifier flags, or null if unmounted. */
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
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
      sendInput(
        ...[pendingMoveRef.current, pendingWheelRef.current].filter(
          (event): event is CefInputEvent => event !== null,
        ),
      );
      pendingMoveRef.current = null;
      pendingWheelRef.current = null;
    }

    function schedulePointerFlush() {
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(flushPointerInput);
      }
    }

    function queueMouseMove(event: ReactMouseEvent<HTMLCanvasElement>, mouseLeave: boolean) {
      const input = mouseInput(event);
      if (!input) return;
      pendingMoveRef.current = { kind: "mouse_move", ...input, mouseLeave };
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
      sendInput(
        ...cefKeyEvents(
          {
            key: event.key,
            keyCode: event.keyCode,
            location: event.location,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            capsLock: event.getModifierState("CapsLock"),
            numLock: event.getModifierState("NumLock"),
          },
          phase,
        ),
      );
    }

    return {
      onFocus: () => sendInput({ kind: "focus", focused: true }),
      onBlur: () => sendInput({ kind: "focus", focused: false }),
      onMouseMove: (event) => queueMouseMove(event, false),
      onMouseLeave: (event) => queueMouseMove(event, true),
      onMouseDown: (event) => sendMouseClick(event, false),
      onMouseUp: (event) => sendMouseClick(event, true),
      onWheel: (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = mouseInput(event);
        if (!input) return;
        const delta = cefWheelDelta(
          event.deltaX,
          event.deltaY,
          event.deltaMode,
          event.currentTarget.clientHeight,
        );
        const pending = pendingWheelRef.current;
        pendingWheelRef.current = {
          kind: "mouse_wheel",
          ...input,
          deltaX: delta.deltaX + (pending?.kind === "mouse_wheel" ? pending.deltaX : 0),
          deltaY: delta.deltaY + (pending?.kind === "mouse_wheel" ? pending.deltaY : 0),
        };
        wheelStartedAtRef.current ??= performance.now();
        schedulePointerFlush();
      },
      onKeyDown: (event) => sendKey(event, "down"),
      onKeyUp: (event) => sendKey(event, "up"),
      onContextMenu: (event) => event.preventDefault(),
    };
  }, [canvasRef]);

  const takeScrollLatencyMs = useCallback(() => {
    const startedAt = wheelStartedAtRef.current;
    if (startedAt === null) return null;
    wheelStartedAtRef.current = null;
    return performance.now() - startedAt;
  }, []);

  useEffect(
    () => () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    },
    [],
  );

  return { handlers, takeScrollLatencyMs };
}
