import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { listen as rawListen } from "@tauri-apps/api/event";
import { devLog, summarizeDevValue } from "@/features/debug-overlay/devLog";

type InvokeArgs = Record<string, unknown> | undefined;
type TauriEvent<T> = { event: string; id: number; payload: T };
type EventHandler<T> = (event: TauriEvent<T>) => void;

let callSequence = 0;

function requestId(args: InvokeArgs): string | undefined {
  const candidate = args?.requestId
    ?? (args?.request && typeof args.request === "object"
      ? (args.request as Record<string, unknown>).requestId
      : undefined);
  return typeof candidate === "string" ? candidate.slice(0, 16) : undefined;
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  const callId = ++callSequence;
  const startedAt = performance.now();
  const id = requestId(args);
  devLog("debug", "tauri", `${command} start`, {
    callId,
    requestId: id,
    args: summarizeDevValue(args),
  });
  try {
    const result = args === undefined
      ? await rawInvoke<T>(command)
      : await rawInvoke<T>(command, args);
    devLog("debug", "tauri", `${command} ok`, {
      callId,
      requestId: id,
      durationMs: elapsed(startedAt),
      result: summarizeDevValue(result),
    });
    return result;
  } catch (error) {
    devLog("error", "tauri", `${command} error`, {
      callId,
      requestId: id,
      durationMs: elapsed(startedAt),
      error,
    });
    throw error;
  }
}

function shouldLogEvent(eventName: string, count: number): boolean {
  if (eventName === "ai-runtime-event" || eventName === "debug-overlay-stats") {
    return count === 1 || count % 50 === 0;
  }
  if (eventName === "whisper-model-download-progress") return count === 1 || count % 10 === 0;
  return true;
}

export function listen<T>(eventName: string, handler: EventHandler<T>): Promise<() => void> {
  let count = 0;
  devLog("debug", "event", `${eventName} subscribe`);
  return rawListen<T>(eventName, (event) => {
    count += 1;
    if (shouldLogEvent(eventName, count)) {
      devLog("debug", "event", `${eventName} event`, {
        count,
        payload: summarizeDevValue(event.payload),
      });
    }
    handler(event);
  }).then((stop) => {
    devLog("debug", "event", `${eventName} ready`);
    return () => {
      stop();
      devLog("debug", "event", `${eventName} unsubscribe`, { count });
    };
  }).catch((error) => {
    devLog("error", "event", `${eventName} subscribe error`, { error });
    throw error;
  });
}
