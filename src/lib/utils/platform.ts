import { platform } from "@tauri-apps/plugin-os";

const PLATFORM = (() => {
  try { return platform(); } catch { return ""; }
})();

export const IS_MAC = PLATFORM === "macos";
export const IS_LINUX = PLATFORM === "linux";
export const IS_WINDOWS = PLATFORM === "windows";

export const USE_CUSTOM_WINDOW_CONTROLS = IS_WINDOWS || IS_LINUX;

/**
 * Whether a Chromium viewport runtime is published for this platform.
 *
 * No longer a compile-time property of the app: CEF lives in a downloadable
 * pack, so this only says a pack exists to fetch. Whether one is actually
 * installed is `viewportPackStatus().installed`. macOS is absent until its
 * helper `.app` bundles and signing are done, and falls back to the iframe.
 */
export const SUPPORTS_CHROMIUM_BROWSER = IS_LINUX || IS_WINDOWS;

/**
 * Shortcut rendering. Keep every user-visible key hint going through these —
 * a hardcoded "⌘" is simply wrong on the Windows and Linux builds.
 */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
export const ALT_KEY = IS_MAC ? "⌥" : "Alt";
export const SHIFT_KEY = IS_MAC ? "⇧" : "Shift";
export const KEY_SEP = IS_MAC ? "" : "+";

export function fmtShortcut(...parts: string[]): string {
  return parts.join(KEY_SEP);
}
