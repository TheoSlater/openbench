import { imageUploadConfig } from "./config";
import type { AttachmentValidationError, ImageValidationError } from "./types";

type ValidationOptions = {
  allowedMimeTypes?: readonly string[];
  maxFileSize?: number;
  maxFiles?: number;
};

export const extensions: Record<string, readonly string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/avif": [".avif"],
  "text/plain": [".txt"],
  "text/markdown": [".md", ".markdown"],
  "text/csv": [".csv"],
  "application/json": [".json"],
};

const attachmentMimeTypes: readonly string[] = [
  ...imageUploadConfig.allowedMimeTypes,
  ...imageUploadConfig.allowedTextMimeTypes,
];

function extensionFor(name: string) {
  const lowerName = name.toLowerCase();
  const dot = lowerName.lastIndexOf(".");
  return dot >= 0 ? lowerName.slice(dot) : "";
}

export function attachmentMimeType(file: Pick<File, "name" | "type">) {
  const type = file.type.trim().toLowerCase();
  const extensionType = Object.entries(extensions).find(([, supportedExtensions]) =>
    supportedExtensions.includes(extensionFor(file.name)),
  )?.[0];

  if (!type || type === "application/octet-stream") return extensionType ?? type;
  if (type === "text/plain" && extensionType && !extensionType.startsWith("image/")) return extensionType;
  return type;
}

function fileSizeLimit(type: string) {
  return type.startsWith("image/")
    ? imageUploadConfig.maxFileSize
    : imageUploadConfig.textMaxFileSize;
}

function typeLabel(type: string) {
  return type.startsWith("image/") ? "images" : "text files";
}

export function validateAttachmentFiles(
  files: File[],
  options: { maxFiles?: number } = {},
) {
  const maxFiles = options.maxFiles ?? imageUploadConfig.maxAttachments;
  const accepted: File[] = [];
  const errors: AttachmentValidationError[] = [];

  for (const file of files) {
    const type = attachmentMimeType(file);
    const extension = extensionFor(file.name);

    if (!attachmentMimeTypes.includes(type)) {
      errors.push({
        code: "unsupported-type",
        fileName: file.name,
        message: `${file.name}: unsupported file type. Use images, TXT, Markdown, CSV, or JSON.`,
      });
      continue;
    }
    if (!extensions[type]?.includes(extension)) {
      errors.push({
        code: "invalid-extension",
        fileName: file.name,
        message: `${file.name}: the file extension does not match its type.`,
      });
      continue;
    }
    if (file.size === 0) {
      errors.push({
        code: "empty-file",
        fileName: file.name,
        message: `${file.name}: the file is empty.`,
      });
      continue;
    }
    const maxFileSize = fileSizeLimit(type);
    if (file.size > maxFileSize) {
      errors.push({
        code: "file-too-large",
        fileName: file.name,
        message: `${file.name}: ${typeLabel(type)} must be ${Math.round(maxFileSize / 1024 / 1024)} MB or smaller.`,
      });
      continue;
    }
    if (accepted.length >= maxFiles) {
      errors.push({
        code: "too-many-files",
        fileName: file.name,
        message: `Maximum ${maxFiles} attachments per message.`,
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, errors };
}

export function validateImageFiles(files: File[], options: ValidationOptions = {}) {
  const allowed = options.allowedMimeTypes ?? imageUploadConfig.allowedMimeTypes;
  const maxFileSize = options.maxFileSize ?? imageUploadConfig.maxFileSize;
  const maxFiles = options.maxFiles ?? imageUploadConfig.maxFiles;
  const accepted: File[] = [];
  const errors: ImageValidationError[] = [];

  for (const [index, file] of files.entries()) {
    if (index >= maxFiles) {
      errors.push({ code: "too-many-files", fileName: file.name, message: `Maximum ${maxFiles} images per message.` });
      continue;
    }
    const type = attachmentMimeType(file);
    if (!allowed.includes(type)) {
      errors.push({ code: "unsupported-type", fileName: file.name, message: `${file.name}: unsupported image type.` });
      continue;
    }
    if (!extensions[type]?.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      errors.push({ code: "invalid-extension", fileName: file.name, message: `${file.name}: extension does not match image type.` });
      continue;
    }
    if (file.size > maxFileSize) {
      errors.push({ code: "file-too-large", fileName: file.name, message: `${file.name}: image exceeds ${Math.round(maxFileSize / 1024 / 1024)} MB limit.` });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, errors };
}

