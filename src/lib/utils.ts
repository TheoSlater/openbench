import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
