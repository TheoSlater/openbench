import { ArrowUp, Square } from "lucide-react";
import { useRef, useEffect } from "react";
import { Box, InputBase, IconButton, Typography } from "@mui/material";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: string;
  hasMessages: boolean;
  allowEmptyModel?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  hasMessages,
  allowEmptyModel = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!value.trim() || isStreaming) return;
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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <Box
      sx={{
        shrink: 0,
        bgcolor: hasMessages ? "#0d0d0d" : "transparent",
        px: 2,
        pb: 3,
        pt: 2,
        position: "relative",
        zIndex: 10,
      }}
    >
      <Box sx={{ mx: "auto", width: "100%", maxWidth: 768 }}>
        <Box
          sx={{
            display: "flex",
            minHeight: 56,
            width: "100%",
            flexDirection: "column",
            gap: 1,
            borderRadius: "2rem",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            bgcolor: "#1a1a1a",
            px: 2.5,
            py: 1.5,
            transition: "all 0.3s",
          }}
        >
          <InputBase
            multiline
            inputRef={textareaRef}
            placeholder="How can I help you today?"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || (!selectedModel && !allowEmptyModel)}
            sx={{
              width: "100%",
              color: "rgba(255, 255, 255, 0.9)",
              fontSize: "16px",
              lineHeight: 1.6,
              "& .MuiInputBase-input": {
                p: 0,
                "&::placeholder": {
                  color: "rgba(255, 255, 255, 0.2)",
                  opacity: 1,
                }
              }
            }}
          />
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", mt: 0.5 }}>
            <IconButton
              onClick={handleAction}
              disabled={isStreaming ? false : !value.trim() || (!selectedModel && !allowEmptyModel)}
              sx={{
                width: 32,
                height: 32,
                bgcolor: (value.trim() || isStreaming) ? "#fff" : "rgba(255, 255, 255, 0.05)",
                color: (value.trim() || isStreaming) ? "#000" : "rgba(255, 255, 255, 0.1)",
                "&:hover": {
                  bgcolor: (value.trim() || isStreaming) ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.05)",
                },
                "&.Mui-disabled": {
                  bgcolor: "rgba(255, 255, 255, 0.05)",
                  color: "rgba(255, 255, 255, 0.1)",
                }
              }}
            >
              {isStreaming ? (
                <Square size={14} fill="currentColor" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.5} />
              )}
            </IconButton>
          </Box>
        </Box>
        {!hasMessages && (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 1.5,
              textAlign: "center",
              fontSize: "11px",
              fontWeight: 500,
              color: "rgba(255, 255, 255, 0.2)"
            }}
          >
            OpenBench can make mistakes. Check important info.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
