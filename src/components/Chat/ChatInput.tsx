import { Square, Plus, ArrowUp, Paperclip, X, Image as ImageIcon } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { Box, InputBase, IconButton, Typography } from "@mui/material";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useChatStore } from "@/store/chatStore";
import { Attachment } from "@/types/chat";
import { isImageAttachment, createDataUrl } from "@/lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: string;
  hasMessages: boolean;
  allowEmptyModel?: boolean;
  onFocusChange?: (focused: boolean) => void;
  isTemporary?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  allowEmptyModel = false,
  onFocusChange,
  isTemporary,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState<string>("*");

  const currentAttachments = useChatStore((state) => state.currentAttachments);
  const { addCurrentAttachment, removeCurrentAttachment } = useChatStore(
    (state) => state.actions,
  );

  const canUploadImages = true;

  const handleFileClick = (accept: string) => {
    setFileAccept(accept);
    // Use a small delay to ensure state update before triggering click
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };

  const handleSubmit = () => {
    if ((!value.trim() && currentAttachments.length === 0) || isStreaming)
      return;
    onSubmit();
  };

  const handleAction = () => {
    if (isStreaming) {
      onStop();
      return;
    }
    handleSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();

        const attachment: Attachment = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
        };

        if (isImageAttachment(file.type)) {
          reader.onload = (e) => {
            const base64 = e.target?.result as string;
            // Ollama expects base64 without prefix
            attachment.content = base64.split(",")[1];
            addCurrentAttachment(attachment);
          };
          reader.readAsDataURL(file);
        } else {
          reader.onload = (e) => {
            attachment.content = e.target?.result as string;
            addCurrentAttachment(attachment);
          };
          reader.readAsText(file);
        }
      }
    },
    [addCurrentAttachment],
  );

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(40, Math.min(textareaRef.current.scrollHeight, 200))}px`;
    }
  }, [value]);

  const canSubmit =
    value.trim() || currentAttachments.length > 0 || isStreaming;
  const isInputDisabled = isStreaming || (!selectedModel && !allowEmptyModel);

  return (
    <Box
      sx={{
        shrink: 0,
        bgcolor: "transparent",
        px: 2,
        pb: 3,
        pt: 2,
        position: "relative",
        zIndex: 10,
      }}
    >
      <input
        type="file"
        multiple
        ref={fileInputRef}
        accept={fileAccept}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <Box sx={{ mx: "auto", width: "100%", maxWidth: 840 }}>
        <Box
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          sx={{
            display: "flex",
            flexDirection: "column",
            minHeight: currentAttachments.length > 0 ? 160 : 120,
            width: "100%",
            borderRadius: "24px",
            bgcolor: isDragging ? "action.selected" : "background.paper",
            p: 1.5,
            transition: "all 0.2s",
            border: isDragging ? "2px dashed" : isTemporary ? "1px dashed" : "1px solid",
            borderColor: isDragging || isTemporary ? "border.main" : "divider",
            "&:focus-within": {
              borderColor: "border.main",
              boxShadow: (theme) => `0 0 0 1px ${theme.palette.border.main}`,
            },
          }}
        >
          {currentAttachments.length > 0 && (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 1.5,
                px: 1.5,
                pt: 1,
                pb: 1,
              }}
            >
              {currentAttachments.map((att) => (
                <Box
                  key={att.id}
                  sx={{
                    position: "relative",
                    width: 64,
                    height: 64,
                    borderRadius: "12px",
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "action.hover",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {att.type.startsWith("image/") ? (
                    <img
                      src={createDataUrl(att.type, att.content || "")}
                      alt={att.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <Paperclip size={24} style={{ color: "text.secondary" }} />
                  )}
                  <IconButton
                    size="small"
                    onClick={() => removeCurrentAttachment(att.id)}
                    sx={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      bgcolor: "background.paper",
                      boxShadow: 1,
                      p: 0.5,
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    <X size={12} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          <InputBase
            multiline
            inputRef={textareaRef}
            placeholder="How can I help you today?"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            disabled={isInputDisabled}
            sx={{
              flex: 1,
              color: "text.primary",
              fontSize: "17px",
              px: 1.5,
              pt: 1,
              "& .MuiInputBase-input": {
                p: 0,
                "&::placeholder": {
                  color: "text.secondary",
                  opacity: 1,
                },
              },
            }}
          />

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 1,
              px: 0.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <IconButton
                    size="small"
                    sx={{ color: "text.secondary", p: 1 }}
                    disabled={isStreaming}
                  >
                    <Plus size={20} />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {canUploadImages && (
                    <DropdownMenuItem
                      onClick={() => handleFileClick("image/*")}
                      className="flex items-center gap-2"
                    >
                      <ImageIcon size={16} />
                      <Typography variant="body2">Upload images</Typography>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => handleFileClick("*")}
                    className="flex items-center gap-2"
                  >
                    <Paperclip size={16} />
                    <Typography variant="body2">Upload files</Typography>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton
                onClick={handleAction}
                disabled={isStreaming ? false : !canSubmit || isInputDisabled}
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor:
                    canSubmit || isStreaming ? "primary.main" : "action.hover",
                  color:
                    canSubmit || isStreaming
                      ? "primary.contrastText"
                      : "text.secondary",
                  "&:hover": {
                    bgcolor:
                      canSubmit || isStreaming
                        ? "primary.main"
                        : "action.selected",
                    opacity: 0.9,
                  },
                  "&.Mui-disabled": {
                    bgcolor: "action.hover",
                    color: "border.main",
                  },
                }}
              >
                {isStreaming ? (
                  <Square size={14} fill="currentColor" />
                ) : (
                  <ArrowUp size={20} strokeWidth={2.5} />
                )}
              </IconButton>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
