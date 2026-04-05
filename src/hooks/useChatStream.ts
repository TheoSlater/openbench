import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload, Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useInspectorStore } from "@/store/inspectorStore";

const MAIN_SYSTEM_PROMPT = `You are a highly capable AI assistant.

Formatting and Content Capabilities:
- You have full support for Markdown formatting. Use bold, italics, code blocks, lists, and tables when appropriate to structure your responses.
- You have robust support for LaTeX mathematics rendering via KaTeX.
  - Always wrap inline mathematical expressions, variables, and symbols in single dollar signs (e.g., $E = mc^2$, $x$, $\\alpha$).
  - Always wrap display-level equations in double dollar signs on their own lines (e.g., $$f(x) = \\int_{-\\infty}^\\infty \\hat{f}(\\xi)\\,e^{2 \\pi i \\xi x} \\,d\\xi$$).
  - Use standard LaTeX environments like \\frac, \\sum, \\sqrt, and matrices where necessary.
  - Ensure equations are correctly formatted and mathematically accurate.

Interaction Guidelines:
- Be clear, concise, and direct in your answers.
- Organize complex explanations into digestible sections using headings.
- If you provide code snippets, always specify the language for proper syntax highlighting.
- When appropriate, break down steps logically and explain your reasoning.
`;

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
  const { addMessage, renameConversation, setStreamingConversationId } =
    useChatStore((state) => state.actions);
  const { addLog, updateLog } = useInspectorStore((state) => state.actions);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    setStreamingConversationId(isStreaming ? activeConversationId : null);
  }, [isStreaming, activeConversationId, setStreamingConversationId]);

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
  const streamingMessageRef = useRef<string>("");
  const currentMessageIdRef = useRef<string | null>(null);
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
    streamingMessageRef.current = "";
    currentMessageIdRef.current = null;
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

    const unlistenPromise = listen<StreamPayload>(
      "chat-chunk",
      async (event) => {
        if (cancelStreamRef.current) {
          return;
        }
        if (!activeConversationId) return;

        if (!event.payload.done) {
          const chunk = event.payload.content;
          streamingMessageRef.current += chunk;

          setStreamingMessage((prev) => {
            if (!prev) {
              const messageId = crypto.randomUUID();
              currentMessageIdRef.current = messageId;
              // Find the most recent log for this model that doesn't have a firstTokenTime yet
              const lastLog = useInspectorStore
                .getState()
                .logs.find(
                  (l) => l.model === selectedModel && !l.timing.firstTokenTime,
                );
              if (lastLog) {
                updateLog(lastLog.id, {
                  timing: {
                    ...lastLog.timing,
                    firstTokenTime: Date.now() - lastLog.timing.startTime,
                  },
                });
              }
              return {
                id: messageId,
                role: "assistant",
                content: chunk,
                conversationId: activeConversationId,
                createdAt: new Date().toISOString(),
              };
            }
            return { ...prev, content: streamingMessageRef.current };
          });
        }

        if (event.payload.done) {
          const finalContent = streamingMessageRef.current;
          const messageId = currentMessageIdRef.current;

          setIsStreaming(false);
          completeReasoning();

          // Find the most recent log for this model that doesn't have a response yet
          const logs = useInspectorStore.getState().logs;
          const lastLog = logs.find(
            (l) => l.model === selectedModel && !l.response,
          );
          if (lastLog) {
            const m = event.payload.metadata;
            updateLog(lastLog.id, {
              response: {
                status: 200,
                headers: {},
                body: {
                  message: { role: "assistant", content: finalContent },
                  done: true,
                  ...m,
                },
              },
              tokens: m
                ? {
                    input: m.prompt_eval_count || 0,
                    output: m.eval_count || 0,
                  }
                : undefined,
              timing: {
                ...lastLog.timing,
                totalTime: Date.now() - lastLog.timing.startTime,
              },
            });
          }

          if (finalContent.trim() && messageId) {
            void addMessage({
              id: messageId,
              conversationId: activeConversationId,
              role: "assistant",
              content: finalContent,
              createdAt: new Date().toISOString(),
            }).then(() => {
              // Auto-rename if first message
              const currentMessages = useChatStore.getState().messages;
              const currentConversation = useChatStore
                .getState()
                .conversations.find((c) => c.id === activeConversationId);

              if (
                currentMessages.length <= 2 &&
                currentConversation?.title === "New Chat"
              ) {
                const userMessage = currentMessages.find(
                  (m) => m.role === "user",
                );
                if (userMessage) {
                  invoke<string>("chat", {
                    model: selectedModel,
                    messages: [
                      {
                        role: "user",
                        content: `Summarize this chat in 2-3 words. Be concise and do not use quotes. Use Title Case.
Text: ${userMessage.content}`,
                      },
                    ],
                  })
                    .then((title) => {
                      if (title && activeConversationId) {
                        // Clean up title (remove quotes, etc)
                        const cleanTitle = title
                          .trim()
                          .replace(/^["']|["']$/g, "")
                          .slice(0, 40);
                        void renameConversation(
                          activeConversationId,
                          cleanTitle,
                        );
                      }
                    })
                    .catch((err) => console.error("Auto-rename failed:", err));
                }
              }
            });
          }

          setStreamingMessage(null);
          streamingMessageRef.current = "";
          currentMessageIdRef.current = null;
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    mockMode,
    completeReasoning,
    activeConversationId,
    addMessage,
    selectedModel,
    renameConversation,
    updateLog,
  ]);

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
    async (content: string, attachments?: Attachment[]) => {
      if (!content.trim() || isStreaming || (!selectedModel && !mockMode)) {
        return;
      }

      cancelStreamRef.current = false;
      const conversationId =
        useChatStore.getState().activeConversationId ?? activeConversationId;
      if (!conversationId) return;

      void addMessage({
        conversationId,
        role: "user",
        content: content.trim(),
        attachments,
      });

      setIsStreaming(true);
      streamingMessageRef.current = "";
      currentMessageIdRef.current = null;
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
            conversationId,
            createdAt,
          });
          setIsStreaming(false);
          completeReasoning();
          void addMessage({
            id: messageId,
            conversationId,
            role: "assistant",
            content: `Mock response: ${content.trim()}`,
            createdAt,
          });
          setStreamingMessage(null);
        }, delayMs);
        return;
      }

      try {
        const history = useChatStore.getState().messages.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments || [],
        }));

        const finalSystemPrompt = systemPrompt.trim()
          ? `${MAIN_SYSTEM_PROMPT}\n\nPersonalization/Custom Instructions:\n${systemPrompt}`
          : MAIN_SYSTEM_PROMPT;

        const requestBody = {
          model: selectedModel,
          messages: [
            ...history,
            {
              role: "user",
              content: content.trim(),
              attachments: attachments || [],
            },
          ],
          systemPrompt: finalSystemPrompt,
        };

        const logId = crypto.randomUUID();
        addLog({
          id: logId,
          model: selectedModel,
          request: {
            url: "tauri://chat_stream",
            method: "POST",
            headers: {},
            body: requestBody,
          },
          timing: {
            startTime: Date.now(),
          },
        });

        await invoke("chat_stream", requestBody);
      } catch (error) {
        console.error("Chat error:", error);
        setIsStreaming(false);
        setReasoningStartAt(null);

        // Add an error message to the chat
        const errorContent =
          typeof error === "string" && error.includes("not found")
            ? `Model "${selectedModel}" not found. Please pull the model or select a different one.`
            : `Failed to connect to Ollama. Make sure it is running. Error: ${error}`;

        void addMessage({
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          content: errorContent,
          createdAt: new Date().toISOString(),
        });
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

  const stopStreaming = useCallback(async () => {
    if (!isStreaming) return;
    cancelStreamRef.current = true;

    try {
      await invoke("cancel_chat");
    } catch (err) {
      console.error("Failed to cancel chat:", err);
    }

    if (mockMode && mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }

    setStreamingMessage((current) => {
      const finalContent = streamingMessageRef.current;
      if (current && finalContent.trim()) {
        void addMessage({
          id: current.id,
          conversationId: current.conversationId,
          role: current.role,
          content: finalContent,
          createdAt: current.createdAt,
        });
      }
      return null;
    });

    setIsStreaming(false);
    streamingMessageRef.current = "";
    currentMessageIdRef.current = null;
    completeReasoning();
    setReasoningStartAt(null);
  }, [isStreaming, mockMode, completeReasoning, addMessage]);

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
