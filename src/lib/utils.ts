import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { invoke } from "@tauri-apps/api/core";
import { useInspectorStore } from "@/store/inspectorStore";

type InvokeArgs = Record<string, unknown>;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A wrapper around Tauri's invoke that logs the call to the inspector.
 */
export async function loggedInvoke<T>(
  cmd: string,
  args: InvokeArgs = {},
): Promise<T> {
  const { addLog, updateLog } = useInspectorStore.getState().actions;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const request = {
    url: `tauri://${cmd}`,
    method: "POST" as const,
    headers: {},
    body: args,
  };

  addLog({
    id: requestId,
    model: "system",
    request,
    timing: { startTime },
  });

  const finishLog = (status: number, body: unknown) => {
    updateLog(requestId, {
      response: {
        status,
        headers: {},
        body,
      },
      timing: { startTime, totalTime: Date.now() - startTime },
    });
  };

  try {
    const result = await invoke<T>(cmd, args);
    finishLog(200, result || { success: true });
    return result;
  } catch (error: unknown) {
    finishLog(500, {
      error:
        error instanceof Error
          ? error.message
          : String(error || "Unknown error"),
    });
    throw error;
  }
}

/**
 * Check if an attachment is an image based on its MIME type.
 */
export function isImageAttachment(type: string): boolean {
  return type.startsWith("image/");
}

/**
 * Create a data URL from a MIME type and base64 content.
 */
export function createDataUrl(type: string, content: string): string {
  return `data:${type};base64,${content}`;
}

/**
 * Format file size in human-readable format.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

/**
 * Clean a title by trimming, removing quotes, and truncating.
 */
export function cleanTitle(title: string, maxLength = 40): string {
  return title
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, maxLength);
}
