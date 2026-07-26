import { Channel, invoke } from "@tauri-apps/api/core";

export type PtyEvent = {
  kind: "data" | "exit" | "error";
  data?: number[];
  message?: string;
};

export function startPty(
  cols: number,
  rows: number,
  onEvent: (event: PtyEvent) => void,
): Promise<string> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("pty_spawn", { cols, rows, onEvent: channel });
}

export function writePty(id: string, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function resizePty(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function closePty(id: string): Promise<void> {
  return invoke("pty_close", { id });
}
