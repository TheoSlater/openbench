import { invoke, type Channel } from "@tauri-apps/api/core";
import type { CefInputEvent } from "./cefInput";

/** Toolbar state pushed by Chromium whenever its loading/history state moves. */
export type CefNavState = {
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export function cefViewportOpen(input: {
  url: string;
  width: number;
  height: number;
  scaleFactor: number;
  onFrame: Channel<ArrayBuffer>;
  onCursor: Channel<string>;
  onAddress: Channel<string>;
  onNavState: Channel<CefNavState>;
}): Promise<void> {
  return invoke("cef_viewport_open", input);
}

/**
 * Navigates the open browser in place, keeping Chromium's session history.
 * Reopening instead would reset that history and break back/forward.
 */
export function cefViewportNavigate(url: string): Promise<void> {
  return invoke("cef_viewport_navigate", { url });
}

export function cefViewportBack(): Promise<void> {
  return invoke("cef_viewport_back");
}

export function cefViewportForward(): Promise<void> {
  return invoke("cef_viewport_forward");
}

export function cefViewportResize(width: number, height: number, scaleFactor: number): Promise<void> {
  return invoke("cef_viewport_resize", { width, height, scaleFactor });
}

export function cefViewportClose(): Promise<void> {
  return invoke("cef_viewport_close");
}

export function cefViewportReload(): Promise<void> {
  return invoke("cef_viewport_reload");
}

export function cefViewportInput(events: CefInputEvent[]): Promise<void> {
  return invoke("cef_viewport_input", { events });
}

export function cefViewportSetEnabled(enabled: boolean): Promise<void> {
  return invoke("cef_viewport_set_enabled", { enabled });
}

export function cefViewportIsEnabled(): Promise<boolean> {
  return invoke<boolean>("cef_viewport_is_enabled");
}

export function restartApp(): Promise<void> {
  return invoke("restart_app");
}
