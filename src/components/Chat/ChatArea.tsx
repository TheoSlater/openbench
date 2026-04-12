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
  userMessage: ChatMessage | null;
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
          result.push({
            userMessage: null,
            assistantMessages: [msg],
            startIndex: index,
          });
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
                borderRadius: "12px",
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "text.secondary",
                color: "text.secondary",
                mb: 1,
              }}
            >
              <Typography
                sx={{
                  fontSize: "12px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Temporary Chat Enabled
              </Typography>
            </Box>
          )}
          {hasMoreMessages && <CircularProgress size={20} color="inherit" />}
        </Box>

        {turns.map((turn, turnIndex) => (
          <Box
            key={turn.userMessage?.id || turn.assistantMessages[0]?.id || `turn-${turnIndex}`}
            sx={{ display: "flex", flexDirection: "column", gap: 1 }}
          >
            {turn.userMessage && (
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
            )}

            {turn.assistantMessages.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md:
                      turn.assistantMessages.length > 1
                        ? `repeat(${Math.min(turn.assistantMessages.length, 3)}, 1fr)`
                        : "1fr",
                  },
                  gap: 1.5,
                  width: "100%",
                  alignItems: "stretch",
                  maxWidth: 768,
                  mx: "auto",
                }}
              >
                {turn.assistantMessages.map((msg, msgIndex) => {
                  return (
                    <Box
                      key={msg.id || `msg-${turnIndex}-${msgIndex}`}
                      sx={{
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        bgcolor: "transparent",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <Message
                        role={msg.role}
                        content={msg.content}
                        attachments={msg.attachments}
                        model={msg.model}
                        thinking={msg.thinking}
                        thinkingDuration={msg.thinkingDuration}
                        isThinking={msg.isThinking}
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
