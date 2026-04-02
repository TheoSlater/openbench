import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload } from "@/types/chat";

export function useChatStream(selectedModel: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for streaming chunks
  useEffect(() => {
    const unlistenPromise = listen<StreamPayload>("chat-chunk", (event) => {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;

        if (lastIndex >= 0 && newMessages[lastIndex].role === "assistant") {
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: newMessages[lastIndex].content + event.payload.content,
          };
        } else {
          newMessages.push({
            role: "assistant",
            content: event.payload.content,
          });
        }
        return newMessages;
      });

      if (event.payload.done) {
        setIsStreaming(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !selectedModel || isStreaming) {
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: content.trim() }]);
      setIsStreaming(true);

      try {
        await invoke("chat_stream", {
          model: selectedModel,
          message: content.trim(),
        });
      } catch (error) {
        console.error("Chat error:", error);
        setIsStreaming(false);
      }
    },
    [selectedModel, isStreaming]
  );

  return {
    messages,
    isStreaming,
    sendMessage,
    bottomRef,
    hasMessages: messages.length > 0,
  };
}