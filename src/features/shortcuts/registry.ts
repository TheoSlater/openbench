import { MOD_KEY } from "@/lib/utils/platform";

/**
 * Every global shortcut, in one place, so the handler and the help dialog can
 * never disagree about what the app actually does.
 */
export type ShortcutDef = {
  id: string;
  label: string;
  group: "Chat" | "Navigation" | "Application";
  /** One entry per key cap, e.g. ["Ctrl", "K"] or ["⌘", "K"]. */
  keys: string[];
};

export const SHORTCUTS: ShortcutDef[] = [
  { id: "new-chat", label: "New chat", group: "Chat", keys: [MOD_KEY, "N"] },
  { id: "focus-composer", label: "Focus the message box", group: "Chat", keys: [MOD_KEY, "L"] },
  { id: "stop", label: "Stop generating", group: "Chat", keys: ["Esc"] },
  { id: "search", label: "Search and commands", group: "Navigation", keys: [MOD_KEY, "K"] },
  { id: "sidebar", label: "Toggle sidebar", group: "Navigation", keys: [MOD_KEY, "B"] },
  { id: "settings", label: "Settings", group: "Application", keys: [MOD_KEY, ","] },
  { id: "shortcuts", label: "Keyboard shortcuts", group: "Application", keys: [MOD_KEY, "/"] },
];

/** Key caps for a shortcut id, for UI that advertises it (palette, sidebar). */
export function shortcutKeys(id: string): string[] | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys;
}

export const SHORTCUT_GROUPS = ["Chat", "Navigation", "Application"] as const;

/** Composer focus is requested from a global handler that has no ref to it. */
export const FOCUS_COMPOSER_EVENT = "polyui:focus-composer";

export function requestComposerFocus() {
  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}
