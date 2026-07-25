import { useRef, useState, useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import { Attachment } from "@/types/chat";
import { isImageAttachment } from "@/lib/utils/utils";
import { validateImageFiles } from "@/lib/image-upload/validation";
import { readImageDimensions } from "@/lib/image-upload/metadata";
import { registerImageAttachment, releaseImageAttachment } from "@/lib/image-upload/attachments";
import { imageUploadConfig } from "@/lib/image-upload/config";
import { useNotify } from "@/hooks/useNotify";
import { optimizeImage } from "@/lib/image-upload/worker";

const EMPTY: Attachment[] = [];

export function useChatAttachments(chatKey: string) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState<string>("*");
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const notify = useNotify();

  const currentAttachments = useChatStore(
    (state) => state.attachmentsByChat[chatKey] ?? EMPTY,
  );
  const storeAddAttachment = useChatStore((state) => state.actions.addAttachment);
  const storeRemoveAttachment = useChatStore((state) => state.actions.removeAttachment);
  const addCurrentAttachment = useCallback(
    (attachment: Attachment) => storeAddAttachment(chatKey, attachment),
    [chatKey, storeAddAttachment],
  );
  const removeCurrentAttachment = useCallback(
    (id: string) => storeRemoveAttachment(chatKey, id),
    [chatKey, storeRemoveAttachment],
  );
  // ponytail: no release-on-unmount. Attachments now outlive the composer on
  // purpose, so their object URLs live until send, removal, or teardown — the
  // same lifetime a draft has. Revisit if blob retention shows up in a profile.

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const selected = Array.from(files);
      const imageFiles = selected.filter((file) => isImageAttachment(file.type));
      const validation = validateImageFiles(imageFiles, {
        maxFiles: Math.max(0, imageUploadConfig.maxFiles - currentAttachments.filter((item) => isImageAttachment(item.type)).length),
      });
      validation.errors.forEach((error) => notify.error("Image upload failed", error.message));
      const acceptedImages = new Set(validation.accepted);
      for (const selectedFile of selected) {
        let file = selectedFile;
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
        };

        const isImage = isImageAttachment(file.type);
        if (isImage) {
          if (!acceptedImages.has(file)) continue;
          file = await optimizeImage(file);
          attachment.name = file.name;
          attachment.type = file.type;
          attachment.size = file.size;
          attachment.status = "previewing";
          attachment.previewUrl = registerImageAttachment(attachment, file);
          addCurrentAttachment(attachment);
          try {
            const dimensions = await readImageDimensions(file);
            if (dimensions.width > imageUploadConfig.maxDimension || dimensions.height > imageUploadConfig.maxDimension) {
              notify.error("Image upload failed", `${file.name}: image dimensions exceed ${imageUploadConfig.maxDimension}px limit.`);
              releaseImageAttachment(attachment);
              removeCurrentAttachment(attachment.id);
            } else {
              attachment.status = "ready";
              Object.assign(attachment, dimensions);
            }
          } catch {
            notify.error("Image upload failed", `${file.name}: image could not be decoded.`);
            releaseImageAttachment(attachment);
            removeCurrentAttachment(attachment.id);
          }
          continue;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          const raw = e.target?.result;
          if (typeof raw !== "string") return;
          attachment.content = isImage ? raw.split(",")[1] : raw;
          addCurrentAttachment(attachment);
        };

        if (isImage) {
          reader.readAsDataURL(file);
        } else {
          reader.readAsText(file);
        }
      }
    },
    [addCurrentAttachment, currentAttachments, notify, removeCurrentAttachment],
  );

  const openFilePicker = (accept: string) => {
    setFileAccept(accept);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  const removeAttachment = useCallback((id: string) => {
    const attachment = currentAttachments.find((item) => item.id === id);
    if (attachment) releaseImageAttachment(attachment);
    removeCurrentAttachment(id);
  }, [currentAttachments, removeCurrentAttachment]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
    }
  }, [processFiles]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  return {
    fileInputRef,
    fileAccept,
    isDragging,
    currentAttachments,
    removeCurrentAttachment: removeAttachment,
    processFiles,
    openFilePicker,
    handleFileChange,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  };
}
