import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauriBridge";
import { devLog } from "@/features/debug-overlay/devLog";

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
  let dataEvents = 0;
  channel.onmessage = (event) => {
    if (event.kind === "data") {
      dataEvents += 1;
      if (dataEvents === 1 || dataEvents % 50 === 0) {
        devLog("debug", "pty", "PTY data received", { dataEvents, bytes: event.data?.length ?? 0 });
      }
    } else {
      devLog(event.kind === "error" ? "error" : "debug", "pty", `PTY ${event.kind}`, {
        hasMessage: Boolean(event.message),
      });
    }
    onEvent(event);
  };
  devLog("debug", "pty", "PTY spawn requested", { cols, rows });
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
