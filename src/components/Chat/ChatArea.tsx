import { useEffect, useRef, useMemo, type RefObject } from "react";
import type { ChatMessage } from "@/types/chat";
import { Message } from "./Message";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useChatStore } from "@/store/chatStore";

interface ChatAreaProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onRegenerate?: (messageIndex: number) => void;
  isTemporary?: boolean;
}

interface MessageTurn {
  userMessage: ChatMessage;
  assistantMessages: ChatMessage[];
  startIndex: number;
}

export function ChatArea({
  messages,
  bottomRef,
  onRegenerate,
  isTemporary,
}: ChatAreaProps) {
  const hasMoreMessages = useChatStore((state) => state.hasMoreMessages);
  const { loadMoreMessages } = useChatStore((state) => state.actions);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMoreMessages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadMoreMessages();
        }
      },
      { threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMoreMessages, loadMoreMessages]);

  const turns = useMemo(() => {
    const result: MessageTurn[] = [];
    let currentTurn: MessageTurn | null = null;

    messages.forEach((msg, index) => {
      if (msg.role === "user") {
        if (currentTurn) {
          result.push(currentTurn);
        }
        currentTurn = {
          userMessage: msg,
          assistantMessages: [],
          startIndex: index,
        };
      } else if (msg.role === "assistant") {
        if (currentTurn) {
          currentTurn.assistantMessages.push(msg);
        } else {
          // Assistant message before any user message (shouldn't happen normally)
          // But handle it by creating a dummy turn if needed or just skip
        }
      }
    });

    if (currentTurn) {
      result.push(currentTurn);
    }

    return result;
  }, [messages]);

  return (
    <Box sx={{ flex: 1, overflowY: "auto" }}>
      <Box
        sx={{
          mx: "auto",
          display: "flex",
          width: "100%",
          maxWidth: 1200,
          flexDirection: "column",
          gap: 3,
          px: { xs: 2, sm: 3 },
          pb: 8,
          pt: 4,
        }}
      >
        <Box
          ref={loadMoreRef}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 2,
            visibility: hasMoreMessages || isTemporary ? "visible" : "hidden",
            height: isTemporary ? "auto" : 40,
            gap: 2,
          }}
        >
          {isTemporary && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.5,
                borderRadius: "20px",
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "primary.main",
                color: "primary.main",
                mb: 1,
              }}
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                style={{ width: 14, height: 14 }}
              >
                <path d="M8 12L11 15L16 10" strokeLinecap="round" strokeLinejoin="round"></path>
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2.5 3.5"
                ></path>
              </svg>
              <Typography sx={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Temporary Chat Enabled
              </Typography>
            </Box>
          )}
          {hasMoreMessages && <CircularProgress size={20} color="inherit" />}
        </Box>

        {turns.map((turn, turnIndex) => (
          <Box key={turn.userMessage.id || `turn-${turnIndex}`} sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box sx={{ maxWidth: 768, mx: "auto", width: "100%" }}>
              <Message
                role={turn.userMessage.role}
                content={turn.userMessage.content}
                attachments={turn.userMessage.attachments}
                model={turn.userMessage.model}
                messageIndex={turn.startIndex}
                onRegenerate={onRegenerate}
              />
            </Box>

            {turn.assistantMessages.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: turn.assistantMessages.length > 1 ? `repeat(${Math.min(turn.assistantMessages.length, 3)}, 1fr)` : "1fr",
                  },
                  gap: 3,
                  width: "100%",
                  alignItems: "stretch",
                }}
              >
                {turn.assistantMessages.map((msg, msgIndex) => {
                  return (
                    <Box
                      key={msg.id || `msg-${turnIndex}-${msgIndex}`}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: "16px",
                        p: 2,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        bgcolor: "background.paper",
                        transition: "all 0.2s ease",
                      }}
                    >
                    <Message
                      role={msg.role}
                      content={msg.content}
                      attachments={msg.attachments}
                      model={msg.model}
                      messageIndex={turn.startIndex + 1 + msgIndex}
                      onRegenerate={onRegenerate}
                    />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        ))}
        <Box ref={bottomRef} sx={{ h: 80 }} />
      </Box>
    </Box>
  );
}
