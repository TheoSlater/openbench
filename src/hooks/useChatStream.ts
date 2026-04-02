import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";

export function useChatStream(
  selectedModel: string,
  supportsReasoning: boolean,
  mockMode = false,
  systemPrompt = "",
) {
  const messages = useChatStore((state) => state.messages);
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  );
  const { addMessage } = useChatStore((state) => state.actions);
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningStartAt, setReasoningStartAt] = useState<number | null>(null);
  const [reasoningElapsedMs, setReasoningElapsedMs] = useState(0);
  const [lastReasoningDurationMs, setLastReasoningDurationMs] = useState<
    number | null
  >(null);
  const [streamingMessage, setStreamingMessage] = useState<{
    id: string;
    role: "assistant";
    content: string;
    conversationId: string;
    createdAt: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelStreamRef = useRef(false);

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

  useEffect(() => {
    cancelStreamRef.current = true;
    if (mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    setStreamingMessage(null);
    setIsStreaming(false);
    setReasoningStartAt(null);
    setReasoningElapsedMs(0);
    setLastReasoningDurationMs(null);
  }, [activeConversationId]);

  // Scroll to bottom when messages change
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (!streamingMessage) return messages;
    return [...messages, streamingMessage];
  }, [messages, streamingMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages]);

  // Listen for streaming chunks
  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<StreamPayload>("chat-chunk", async (event) => {
      if (cancelStreamRef.current) {
        return;
      }
      if (!activeConversationId) return;

      setStreamingMessage((prev) => {
        const content = (prev?.content ?? "") + event.payload.content;
        if (prev) {
          return { ...prev, content };
        }
        return {
          id: crypto.randomUUID(),
          role: "assistant",
          content,
          conversationId: activeConversationId,
          createdAt: new Date().toISOString(),
        };
      });

      if (event.payload.done) {
        setIsStreaming(false);
        completeReasoning();
        setStreamingMessage((current) => {
          if (current) {
            void addMessage({
              id: current.id,
              conversationId: current.conversationId,
              role: current.role,
              content: current.content,
              createdAt: current.createdAt,
            });
          }
          return null;
        });
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [mockMode, completeReasoning, activeConversationId, addMessage]);

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
    async (content: string) => {
      if (!content.trim() || isStreaming || (!selectedModel && !mockMode)) {
        return;
      }

      cancelStreamRef.current = false;
      if (!activeConversationId) return;
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
          const createdAt = new Date().toISOString();
          const messageId = crypto.randomUUID();
          setStreamingMessage({
            id: messageId,
            role: "assistant",
            content: `Mock response: ${content.trim()}`,
            conversationId: activeConversationId,
            createdAt,
          });
          setIsStreaming(false);
          completeReasoning();
          void addMessage({
            id: messageId,
            conversationId: activeConversationId,
            role: "assistant",
            content: `Mock response: ${content.trim()}`,
            createdAt,
          });
          setStreamingMessage(null);
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
      activeConversationId,
      completeReasoning,
      addMessage,
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
    setStreamingMessage(null);
  }, [isStreaming, mockMode, completeReasoning]);

  return {
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages: displayMessages.length > 0,
    reasoningElapsedMs,
    lastReasoningDurationMs,
  };
}
