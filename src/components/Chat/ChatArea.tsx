import { useEffect, useRef, type RefObject } from "react";
import type { ChatMessage } from "@/types/chat";
import { Message } from "./Message";
import { Box, CircularProgress } from "@mui/material";
import { useChatStore } from "@/store/chatStore";

interface ChatAreaProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onRegenerate?: (messageIndex: number) => void;
}

export function ChatArea({ messages, bottomRef, onRegenerate }: ChatAreaProps) {
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

  return (
    <Box sx={{ flex: 1, overflowY: "auto" }}>
      <Box
        sx={{
          mx: "auto",
          display: "flex",
          width: "100%",
          maxWidth: 768,
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
            justifyContent: "center",
            py: 2,
            visibility: hasMoreMessages ? "visible" : "hidden",
            height: 40,
          }}
        >
          {hasMoreMessages && <CircularProgress size={20} color="inherit" />}
        </Box>

        {messages.map((msg, i) => (
          <Message
            key={msg.id || i}
            role={msg.role}
            content={msg.content}
            attachments={msg.attachments}
            model={msg.model}
            messageIndex={i}
            onRegenerate={onRegenerate}
          />
        ))}
        <Box ref={bottomRef} sx={{ h: 80 }} />
      </Box>
    </Box>
  );
}
