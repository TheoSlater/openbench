import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { extensions as imageExtensions } from "@/lib/image-upload/validation";
import { useNotificationStore } from "@/store/notificationStore";
import { devLog } from "@/features/debug-overlay/devLog";

type UseFileDragDetectionOptions = {
  onFilesDropped?: (files: File[]) => void;
  enabled?: boolean;
  debug?: boolean;
};

const FILE_DRAG_TYPES = new Set(["files", "text/uri-list", "application/x-moz-file"]);

const mimeByExtension = Object.entries(imageExtensions).reduce<Record<string, string>>(
  (acc, [mime, exts]) => {
    exts.forEach((ext) => {
      acc[ext] = mime;
    });
    return acc;
  },
  {},
);

function nameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function mimeFromPath(path: string) {
  const name = nameFromPath(path).toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));
  return mimeByExtension[ext] ?? "";
}

// WebKitGTK on Linux does not populate DataTransfer with real File objects on
// drop, so dropped paths are read via Tauri's native window drag-drop event
// (see tauri.linux.conf.json: dragDropEnabled) and turned into File objects.
async function fileFromPath(path: string) {
  const bytes = await readFile(path);
  return new File([bytes], nameFromPath(path), { type: mimeFromPath(path) });
}

function hasFileDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).some((type) =>
    FILE_DRAG_TYPES.has(type.toLowerCase()),
  );
}

export function filesFromTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files);
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function useFileDragDetection({
  onFilesDropped,
  enabled = true,
  debug = false,
}: UseFileDragDetectionOptions = {}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const onFilesDroppedRef = useRef(onFilesDropped);

  useEffect(() => {
    onFilesDroppedRef.current = onFilesDropped;
  }, [onFilesDropped]);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;

    const logDragEvent = (name: string, event?: DragEvent) => {
      if (!debug) return;
      devLog("debug", "file-drag", name, {
        depth: dragDepthRef.current,
        files: event?.dataTransfer?.files?.length ?? 0,
        types: Array.from(event?.dataTransfer?.types ?? []),
      });
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
      logDragEvent("dragenter", event);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
      logDragEvent("dragover", event);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;

      if (dragDepthRef.current === 0 || leftWindow) {
        resetDragState();
      }
      logDragEvent("dragleave", event);
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = filesFromTransfer(event.dataTransfer);
      resetDragState();
      logDragEvent("drop", event);
      if (files.length > 0) onFilesDroppedRef.current?.(files);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") resetDragState();
    };

    document.addEventListener("dragenter", handleDragEnter, true);
    document.addEventListener("dragover", handleDragOver, true);
    document.addEventListener("dragleave", handleDragLeave, true);
    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("dragend", resetDragState, true);
    window.addEventListener("blur", resetDragState, true);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter, true);
      document.removeEventListener("dragover", handleDragOver, true);
      document.removeEventListener("dragleave", handleDragLeave, true);
      document.removeEventListener("drop", handleDrop, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("dragend", resetDragState, true);
      window.removeEventListener("blur", resetDragState, true);
    };
  }, [debug, enabled, resetDragState]);

  // Only fires when native window drag-drop is enabled (Linux); the browser
  // dragDropEnabled=false path above handles other platforms.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "drop") {
          resetDragState();
          Promise.all(payload.paths.map(fileFromPath))
            .then((files) => {
              if (files.length > 0) onFilesDroppedRef.current?.(files);
            })
            .catch(() => {
              useNotificationStore.getState().actions.add({
                type: "error",
                message: "Couldn't read dropped files",
                description: "The files may have been moved or aren't readable.",
                duration: 5000,
              });
            });
        } else if (payload.type === "enter" || payload.type === "over") {
          setIsDraggingFiles(true);
        } else {
          resetDragState();
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, resetDragState]);

  return {
    isDraggingFiles,
    resetDragState,
  };
}
