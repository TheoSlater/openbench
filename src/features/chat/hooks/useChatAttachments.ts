import { useRef, useState, useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import { Attachment } from "@/types/chat";
import { isImageAttachment } from "@/lib/utils/utils";
import { attachmentMimeType, validateAttachmentFiles } from "@/lib/image-upload/validation";
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
  const storeUpdateAttachment = useChatStore((state) => state.actions.updateAttachment);
  const storeRemoveAttachment = useChatStore((state) => state.actions.removeAttachment);
  const addCurrentAttachment = useCallback(
    (attachment: Attachment) => storeAddAttachment(chatKey, attachment),
    [chatKey, storeAddAttachment],
  );
  const updateCurrentAttachment = useCallback(
    (id: string, updates: Partial<Attachment>) => storeUpdateAttachment(chatKey, id, updates),
    [chatKey, storeUpdateAttachment],
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
      const existingCount = useChatStore.getState().attachmentsByChat[chatKey]?.length ?? 0;
      const validation = validateAttachmentFiles(selected, {
        maxFiles: Math.max(0, imageUploadConfig.maxAttachments - existingCount),
      });
      if (validation.errors.length > 0) {
        notify.error(
          `${validation.errors.length} file${validation.errors.length === 1 ? "" : "s"} not added`,
          validation.errors.map((error) => error.message).join(" "),
        );
      }
      const acceptedFiles = new Set(validation.accepted);
      for (const selectedFile of selected) {
        if (!acceptedFiles.has(selectedFile)) continue;
        let file = selectedFile;
        const normalizedType = attachmentMimeType(file);
        const attachment: Attachment = {
          id: crypto.randomUUID(),
          name: file.name,
          type: normalizedType,
          size: file.size,
        };

        const isImage = isImageAttachment(normalizedType);
        if (isImage) {
          file = await optimizeImage(file);
          attachment.name = file.name;
          attachment.type = attachmentMimeType(file);
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
              updateCurrentAttachment(attachment.id, { ...dimensions, status: "ready" });
            }
          } catch {
            notify.error("Image upload failed", `${file.name}: image could not be decoded.`);
            releaseImageAttachment(attachment);
            removeCurrentAttachment(attachment.id);
          }
          continue;
        }

        attachment.status = "processing";
        addCurrentAttachment(attachment);
        const reader = new FileReader();
        reader.onload = (e) => {
          const raw = e.target?.result;
          if (typeof raw !== "string" || !raw) {
            notify.error("File could not be read", `${file.name}: the file did not contain readable text.`);
            removeCurrentAttachment(attachment.id);
            return;
          }
          updateCurrentAttachment(attachment.id, { content: raw, status: "ready" });
        };
        reader.onerror = () => {
          notify.error("File could not be read", `${file.name}: the file may be unreadable or damaged.`);
          removeCurrentAttachment(attachment.id);
        };
        reader.readAsText(file);
      }
    },
    [
      addCurrentAttachment,
      chatKey,
      notify,
      removeCurrentAttachment,
      updateCurrentAttachment,
    ],
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
