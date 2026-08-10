import { invoke } from "@/lib/tauriBridge";

type InvokeArgs = Record<string, unknown>;

export async function loggedInvoke<T>(cmd: string, args: InvokeArgs = {}): Promise<T> {
  return invoke<T>(cmd, args);
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem("session_token");
  } catch {
    return null;
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
