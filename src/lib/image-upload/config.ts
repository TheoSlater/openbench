export const imageUploadConfig = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
  allowedTextMimeTypes: ["text/plain", "text/markdown", "text/csv", "application/json"],
  maxFileSize: 20 * 1024 * 1024,
  maxFiles: 8,
  maxAttachments: 8,
  textMaxFileSize: 1 * 1024 * 1024,
  maxDimension: 8192,
  optimizeAboveBytes: 2 * 1024 * 1024,
  outputMaxDimension: 2048,
  outputQuality: 0.86,
} as const;

