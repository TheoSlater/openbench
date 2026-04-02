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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-6">
        {messages.map((msg, i) => (
          <Message key={i} role={msg.role} content={msg.content} />
        ))}
        <div ref={bottomRef} className="h-20" />
      </div>
    </div>
  );
}
