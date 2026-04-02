import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload } from "@/types/chat";

export function useChatStream(
  selectedModel: string,
  supportsReasoning: boolean,
  mockMode = false,
  systemPrompt = "",
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningStartAt, setReasoningStartAt] = useState<number | null>(null);
  const [reasoningElapsedMs, setReasoningElapsedMs] = useState(0);
  const [lastReasoningDurationMs, setLastReasoningDurationMs] = useState<
    number | null
  >(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelStreamRef = useRef(false);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const removeMessageAt = useCallback((indexToRemove: number) => {
    setMessages((prev) => prev.filter((_, index) => index !== indexToRemove));
  }, []);

  const completeReasoning = useCallback(() => {
    if (!supportsReasoning) return;
    setReasoningStartAt((start) => {
      if (start === null) return null;
      const elapsed = Date.now() - start;
      setLastReasoningDurationMs(elapsed);
      setReasoningElapsedMs(elapsed);
      return null;
    });
  }, [supportsReasoning]);

  useEffect(() => {
    setReasoningStartAt(null);
    setReasoningElapsedMs(0);
    setLastReasoningDurationMs(null);
  }, [selectedModel]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for streaming chunks
  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<StreamPayload>("chat-chunk", (event) => {
      if (cancelStreamRef.current) {
        return;
      }
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
        completeReasoning();
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [mockMode, completeReasoning]);

  useEffect(() => {
    if (!reasoningStartAt) return;

    const interval = setInterval(() => {
      setReasoningElapsedMs(Date.now() - reasoningStartAt);
    }, 250);

    return () => clearInterval(interval);
  }, [reasoningStartAt]);

  useEffect(() => {
    return () => {
      if (mockTimerRef.current) {
        clearTimeout(mockTimerRef.current);
        mockTimerRef.current = null;
      }
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string, options?: { skipUserAppend?: boolean }) => {
      if (!content.trim() || isStreaming || (!selectedModel && !mockMode)) {
        return;
      }

      cancelStreamRef.current = false;
      if (!options?.skipUserAppend) {
        appendMessage({ role: "user", content: content.trim() });
      }
      setIsStreaming(true);
      if (supportsReasoning) {
        const start = Date.now();
        setReasoningStartAt(start);
        setReasoningElapsedMs(0);
        setLastReasoningDurationMs(null);
      }

      if (mockMode) {
        if (mockTimerRef.current) {
          clearTimeout(mockTimerRef.current);
        }

        const delayMs = 600 + Math.round(Math.random() * 400);
        mockTimerRef.current = setTimeout(() => {
          appendMessage({
            role: "assistant",
            content: `Mock response: ${content.trim()}`,
          });
          setIsStreaming(false);
          completeReasoning();
        }, delayMs);
        return;
      }

      try {
        await invoke("chat_stream", {
          model: selectedModel,
          message: content.trim(),
          systemPrompt,
        });
      } catch (error) {
        console.error("Chat error:", error);
        setIsStreaming(false);
        setReasoningStartAt(null);
      }
    },
    [
      selectedModel,
      isStreaming,
      supportsReasoning,
      mockMode,
      systemPrompt,
      appendMessage,
      completeReasoning,
    ],
  );

  const stopStreaming = useCallback(() => {
    if (!isStreaming) return;
    cancelStreamRef.current = true;

    if (mockMode && mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }

    setIsStreaming(false);
    completeReasoning();
    setReasoningStartAt(null);
  }, [isStreaming, mockMode, completeReasoning]);

  return {
    messages,
    isStreaming,
    appendMessage,
    sendMessage,
    stopStreaming,
    removeMessageAt,
    bottomRef,
    hasMessages: messages.length > 0,
    reasoningElapsedMs,
    lastReasoningDurationMs,
  };
}
