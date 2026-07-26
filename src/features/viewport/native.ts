import { invoke, type Channel } from "@tauri-apps/api/core";
import type { CefInputEvent } from "./cefInput";

/** Toolbar state pushed by Chromium whenever its loading/history state moves. */
export type CefNavState = {
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export function cefViewportOpen(input: {
  id: number;
  url: string;
  width: number;
  height: number;
  scaleFactor: number;
  onFrame: Channel<ArrayBuffer>;
  onCursor: Channel<string>;
  onAddress: Channel<string>;
  onNavState: Channel<CefNavState>;
  onError: Channel<string>;
}): Promise<void> {
  return invoke("cef_viewport_open", input);
}

/**
 * Navigates the open browser in place, keeping Chromium's session history.
 * Reopening instead would reset that history and break back/forward.
 */
export function cefViewportNavigate(id: number, url: string): Promise<void> {
  return invoke("cef_viewport_navigate", { id, url });
}

export function cefViewportBack(id: number): Promise<void> {
  return invoke("cef_viewport_back", { id });
}

export function cefViewportForward(id: number): Promise<void> {
  return invoke("cef_viewport_forward", { id });
}

export function cefViewportResize(
  id: number,
  width: number,
  height: number,
  scaleFactor: number,
): Promise<void> {
  return invoke("cef_viewport_resize", { id, width, height, scaleFactor });
}

export function cefViewportClose(id: number): Promise<void> {
  return invoke("cef_viewport_close", { id });
}

export function cefViewportReload(id: number): Promise<void> {
  return invoke("cef_viewport_reload", { id });
}

export function cefViewportInput(id: number, events: CefInputEvent[]): Promise<void> {
  return invoke("cef_viewport_input", { id, events });
}

export function cefViewportSetEnabled(enabled: boolean): Promise<void> {
  return invoke("cef_viewport_set_enabled", { enabled });
}

export function cefViewportIsEnabled(): Promise<boolean> {
  return invoke<boolean>("cef_viewport_is_enabled");
}

/** Whether the downloaded browser runtime is present and runnable. */
export function cefViewportIsInstalled(): Promise<boolean> {
  return invoke<boolean>("cef_viewport_is_installed");
}

export type ViewportPackStatus = {
  installed: boolean;
  supported: boolean;
  version: string;
};

export function viewportPackStatus(): Promise<ViewportPackStatus> {
  return invoke<ViewportPackStatus>("viewport_pack_status");
}

/** Downloads and installs the CEF runtime. Emits `viewport-pack-progress`. */
export function viewportPackInstall(): Promise<void> {
  return invoke("viewport_pack_install");
}

export function viewportPackRemove(): Promise<void> {
  return invoke("viewport_pack_remove");
}

export function restartApp(): Promise<void> {
  return invoke("restart_app");
}
