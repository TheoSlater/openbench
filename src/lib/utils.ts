import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { invoke } from "@tauri-apps/api/core";
import { useInspectorStore } from "@/store/inspectorStore";

type InvokeArgs = Record<string, unknown>;

function estimateJsonBytes(_args: InvokeArgs): number {
  return 0;
}

function perfLog(..._args: unknown[]): void {}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function loggedInvoke<T>(cmd: string, args: InvokeArgs = {}): Promise<T> {
  const { addLog, updateLog } = useInspectorStore.getState().actions;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  const request = {
    url: `tauri://${cmd}`,
    method: "POST" as const,
    headers: {},
    body: args,
  };
  const payloadBytes = estimateJsonBytes(args);

  addLog({
    id: requestId,
    model: "system",
    request,
    timing: { startTime },
  });

  const finishLog = (status: number, body: unknown) => {
    const totalTime = Date.now() - startTime;
    perfLog("tauri-invoke", cmd, { status, payloadBytes, responseBytes: estimateJsonBytes(body as InvokeArgs) }, totalTime);
    updateLog(requestId, {
      response: { status, headers: {}, body },
      timing: { startTime, totalTime },
    });
  };

  try {
    const result = await invoke<T>(cmd, args);
    finishLog(200, result ?? { success: true });
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");
    finishLog(500, { error: errorMessage });
    throw error;
  }
}

export function isImageAttachment(type: string): boolean {
  return type.startsWith("image/");
}

export function createDataUrl(type: string, content: string): string {
  return `data:${type};base64,${content}`;
}

export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  const gb = mb / 1024;

  if (bytes < 1024) return `${bytes} B`;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${gb.toFixed(1)} GB`;
}

export function cleanTitle(title: string, maxLength = 40): string {
  return title.trim().replace(/^["']|["']$/g, "").slice(0, maxLength);
}
