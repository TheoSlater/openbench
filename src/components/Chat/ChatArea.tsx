import type { RefObject } from "react";
import type { ChatMessage } from "@/types/chat";
import { Message } from "./Message";

interface ChatAreaProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
}

export function ChatArea({ messages, bottomRef }: ChatAreaProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {messages.map((msg, i) => (
        <Message key={i} role={msg.role} content={msg.content} />
      ))}
      <div ref={bottomRef} className="h-8" />
    </div>
  );
}