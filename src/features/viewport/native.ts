import { invoke, type Channel } from "@tauri-apps/api/core";
import type { CefInputEvent } from "./cefInput";

export function cefViewportOpen(input: {
  url: string;
  width: number;
  height: number;
  scaleFactor: number;
  onFrame: Channel<ArrayBuffer>;
  onCursor: Channel<string>;
  onAddress: Channel<string>;
}): Promise<void> {
  return invoke("cef_viewport_open", input);
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
