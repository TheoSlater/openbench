export type ImageUploadStatus = "previewing" | "ready" | "processing" | "error";

export type ImageValidationErrorCode =
  | "unsupported-type"
  | "invalid-extension"
  | "file-too-large"
  | "too-many-files"
  | "empty-file"
  | "dimensions-too-large"
  | "corrupt-image";

export interface ImageValidationError {
  code: ImageValidationErrorCode;
  fileName: string;
  message: string;
}

export type AttachmentValidationErrorCode = Exclude<
  ImageValidationErrorCode,
  "dimensions-too-large" | "corrupt-image"
>;

export interface AttachmentValidationError {
  code: AttachmentValidationErrorCode;
  fileName: string;
  message: string;
}

