import type { RefObject } from "react";
import type { ChatMessage } from "@/types/chat";
import { Message } from "./Message";
import { Box } from "@mui/material";

interface ChatAreaProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onRegenerate?: (messageIndex: number) => void;
}

export function ChatArea({ messages, bottomRef, onRegenerate }: ChatAreaProps) {
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
        {messages.map((msg, i) => (
          <Message
            key={i}
            role={msg.role}
            content={msg.content}
            messageIndex={i}
            onRegenerate={onRegenerate}
          />
        ))}
        <Box ref={bottomRef} sx={{ h: 80 }} />
      </Box>
    </Box>
  );
}
