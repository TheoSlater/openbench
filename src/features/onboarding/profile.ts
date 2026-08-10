import { imageUploadConfig } from "@/lib/image-upload/config";
import { validateImageFiles } from "@/lib/image-upload/validation";

export const PROFILE_NAME_MAX = 80;
const PROFILE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const PROFILE_IMAGE_MAX_DIMENSION = 512;

export function normalizeDisplayName(value: string): string {
  return value.trim().slice(0, PROFILE_NAME_MAX);
}

export function profileLabel(value: string): string {
  return normalizeDisplayName(value) || "You";
}

export function profileInitials(value: string): string {
  const name = profileLabel(value);
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Image could not be read."));
    };
    reader.onerror = () => reject(new Error("Image could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be decoded."));
    image.src = source;
  });
}

export async function readProfileImage(file: File): Promise<string> {
  const validation = validateImageFiles([file], {
    allowedMimeTypes: imageUploadConfig.allowedMimeTypes,
    maxFileSize: PROFILE_IMAGE_MAX_BYTES,
    maxFiles: 1,
  });
  if (validation.errors[0]) throw new Error(validation.errors[0].message);

  const source = await readDataUrl(file);
  const image = await loadImage(source);
  const scale = Math.min(
    1,
    PROFILE_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86);
}
