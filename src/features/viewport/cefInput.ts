const WHEEL_LINE_PIXELS = 40;

const FLAG_CAPS_LOCK = 1;
const FLAG_SHIFT = 2;
const FLAG_CONTROL = 4;
const FLAG_ALT = 8;
const FLAG_LEFT_MOUSE = 16;
const FLAG_MIDDLE_MOUSE = 32;
const FLAG_RIGHT_MOUSE = 64;
const FLAG_COMMAND = 128;
const FLAG_NUM_LOCK = 256;
const FLAG_KEYPAD = 512;
const FLAG_LEFT = 1024;
const FLAG_RIGHT = 2048;

export type CefInputEvent =
  | { kind: "focus"; focused: boolean }
  | { kind: "mouse_move"; x: number; y: number; modifiers: number; mouseLeave: boolean }
  | {
      kind: "mouse_click";
      x: number;
      y: number;
      modifiers: number;
      button: "left" | "middle" | "right";
      mouseUp: boolean;
      clickCount: number;
    }
  | { kind: "mouse_wheel"; x: number; y: number; modifiers: number; deltaX: number; deltaY: number }
  | {
      kind: "key";
      eventType: "raw_key_down" | "key_up" | "char";
      modifiers: number;
      windowsKeyCode: number;
      nativeKeyCode: number;
      isSystemKey: boolean;
      character: number;
      unmodifiedCharacter: number;
    };

type Bounds = { left: number; top: number; width: number; height: number };

type ModifierSource = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  buttons?: number;
  location?: number;
  capsLock?: boolean;
  numLock?: boolean;
};

type KeySource = ModifierSource & {
  key: string;
  keyCode: number;
};

export function cefCoordinates(
  clientX: number,
  clientY: number,
  bounds: Bounds,
  backingWidth: number,
  backingHeight: number,
): { x: number; y: number } {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.round((clientX - bounds.left) * (backingWidth / bounds.width)),
    y: Math.round((clientY - bounds.top) * (backingHeight / bounds.height)),
  };
}

export function cefModifiers(source: ModifierSource): number {
  let flags = 0;
  if (source.capsLock) flags |= FLAG_CAPS_LOCK;
  if (source.shiftKey) flags |= FLAG_SHIFT;
  if (source.ctrlKey) flags |= FLAG_CONTROL;
  if (source.altKey) flags |= FLAG_ALT;
  if ((source.buttons ?? 0) & 1) flags |= FLAG_LEFT_MOUSE;
  if ((source.buttons ?? 0) & 4) flags |= FLAG_MIDDLE_MOUSE;
  if ((source.buttons ?? 0) & 2) flags |= FLAG_RIGHT_MOUSE;
  if (source.metaKey) flags |= FLAG_COMMAND;
  if (source.numLock) flags |= FLAG_NUM_LOCK;
  if (source.location === 3) flags |= FLAG_KEYPAD;
  if (source.location === 1) flags |= FLAG_LEFT;
  if (source.location === 2) flags |= FLAG_RIGHT;
  return flags;
}

export function cefWheelDelta(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): { deltaX: number; deltaY: number } {
  const unit = deltaMode === 1 ? WHEEL_LINE_PIXELS : deltaMode === 2 ? pageHeight : 1;
  const x = Math.round(-deltaX * unit);
  const y = Math.round(-deltaY * unit);
  return { deltaX: x || 0, deltaY: y || 0 };
}

export function cefKeyEvents(source: KeySource, phase: "down" | "up"): CefInputEvent[] {
  const modifiers = cefModifiers(source);
  const base = {
    kind: "key" as const,
    modifiers,
    windowsKeyCode: source.keyCode,
    nativeKeyCode: source.keyCode,
    isSystemKey: source.altKey,
    character: 0,
    unmodifiedCharacter: 0,
  };
  if (phase === "up") return [{ ...base, eventType: "key_up" }];

  const events: CefInputEvent[] = [{ ...base, eventType: "raw_key_down" }];
  if (source.key.length === 1 && !source.ctrlKey && !source.metaKey && !source.altKey) {
    events.push({
      ...base,
      eventType: "char",
      character: source.key.charCodeAt(0),
      unmodifiedCharacter: source.key.toLowerCase().charCodeAt(0),
    });
  }
  return events;
}
