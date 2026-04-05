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
  selectedModels: string[],
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
  
  // Track streaming messages per request_id
  const [streamingMessages, setStreamingMessages] = useState<Record<string, {
    id: string;
    role: "assistant";
    content: string;
    conversationId: string;
    createdAt: string;
    model: string;
  }>>({});
  
  const streamingMessagesRef = useRef<Record<string, string>>({});
  const messageIdsRef = useRef<Record<string, string>>({});
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
  }, [selectedModels]);

  useEffect(() => {
    cancelStreamRef.current = true;
    if (mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    setStreamingMessages({});
    streamingMessagesRef.current = {};
    messageIdsRef.current = {};
    setIsStreaming(false);
    setReasoningStartAt(null);
    setReasoningElapsedMs(0);
    setLastReasoningDurationMs(null);
  }, [activeConversationId]);

  // Scroll to bottom when messages change
  const displayMessages = useMemo<ChatMessage[]>(() => {
    const streamList = Object.values(streamingMessages);
    if (streamList.length === 0) return messages;
    return [...messages, ...streamList];
  }, [messages, streamingMessages]);

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

        const { request_id, done, content, metadata } = event.payload;

        if (!done) {
          streamingMessagesRef.current[request_id] = (streamingMessagesRef.current[request_id] || "") + content;

          setStreamingMessages((prev) => {
            if (!prev[request_id]) {
              const messageId = crypto.randomUUID();
              messageIdsRef.current[request_id] = messageId;
              
              const lastLog = useInspectorStore
                .getState()
                .logs.find(
                  (l) => l.id === request_id,
                );
              const model = lastLog?.model || "unknown";

              if (lastLog && !lastLog.timing.firstTokenTime) {
                updateLog(lastLog.id, {
                  timing: {
                    ...lastLog.timing,
                    firstTokenTime: Date.now() - lastLog.timing.startTime,
                  },
                });
              }
              return {
                ...prev,
                [request_id]: {
                  id: messageId,
                  role: "assistant",
                  content: content,
                  conversationId: activeConversationId,
                  createdAt: new Date().toISOString(),
                  model,
                },
              };
            }
            return { 
              ...prev, 
              [request_id]: { 
                ...prev[request_id], 
                content: streamingMessagesRef.current[request_id] 
              } 
            };
          });
        }

        if (done) {
          const finalContent = streamingMessagesRef.current[request_id] || "";
          const messageId = messageIdsRef.current[request_id];
          const model = streamingMessages[request_id]?.model;

          // Check if all streams are done
          const remainingStreams = Object.keys(streamingMessagesRef.current).filter(id => id !== request_id);
          if (remainingStreams.length === 0) {
            setIsStreaming(false);
            completeReasoning();
          }

          const lastLog = useInspectorStore.getState().logs.find(
            (l) => l.id === request_id,
          );
          if (lastLog) {
            updateLog(lastLog.id, {
              response: {
                status: 200,
                headers: {},
                body: {
                  message: { role: "assistant", content: finalContent },
                  done: true,
                  ...metadata,
                },
              },
              tokens: metadata
                ? {
                    input: metadata.prompt_eval_count || 0,
                    output: metadata.eval_count || 0,
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
              model,
            }).then(() => {
              const currentMessages = useChatStore.getState().messages;
              const currentConversation = useChatStore
                .getState()
                .conversations.find((c) => c.id === activeConversationId);

              if (
                currentMessages.length <= 2 &&
                currentConversation?.title === "New Chat" &&
                model
              ) {
                const userMessage = currentMessages.find(
                  (m) => m.role === "user",
                );
                if (userMessage) {
                  invoke<string>("chat", {
                    model: model,
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

          setStreamingMessages(prev => {
            const next = { ...prev };
            delete next[request_id];
            return next;
          });
          delete streamingMessagesRef.current[request_id];
          delete messageIdsRef.current[request_id];
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
    streamingMessages,
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
      const models = selectedModels.filter(m => !!m);
      if (!content.trim() || isStreaming || (models.length === 0 && !mockMode)) {
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
      setStreamingMessages({});
      streamingMessagesRef.current = {};
      messageIdsRef.current = {};
      
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
          setIsStreaming(false);
          completeReasoning();
          void addMessage({
            id: messageId,
            conversationId,
            role: "assistant",
            content: `Mock response: ${content.trim()}`,
            createdAt,
            model: "mock-model",
          });
        }, delayMs);
        return;
      }

      const history = useChatStore.getState().messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments || [],
      }));

      const finalSystemPrompt = systemPrompt.trim()
        ? `${MAIN_SYSTEM_PROMPT}\n\nPersonalization/Custom Instructions:\n${systemPrompt}`
        : MAIN_SYSTEM_PROMPT;

      for (const model of models) {
        const request_id = crypto.randomUUID();
        const requestBody = {
          request_id,
          model,
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

        addLog({
          id: request_id,
          model: model,
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

        invoke("chat_stream", requestBody).catch(error => {
          console.error(`Chat error for model ${model}:`, error);
          
          const errorContent =
            typeof error === "string" && error.includes("not found")
              ? `Model "${model}" not found. Please pull the model or select a different one.`
              : `Failed to connect to Ollama for model ${model}. Error: ${error}`;

          void addMessage({
            id: crypto.randomUUID(),
            conversationId,
            role: "assistant",
            content: errorContent,
            createdAt: new Date().toISOString(),
            model,
          });
        });
      }
    },
    [
      selectedModels,
      isStreaming,
      supportsReasoning,
      mockMode,
      systemPrompt,
      activeConversationId,
      completeReasoning,
      addMessage,
      addLog,
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

    const currentStreams = { ...streamingMessages };
    Object.entries(currentStreams).forEach(([request_id, msg]) => {
      const finalContent = streamingMessagesRef.current[request_id];
      if (finalContent && finalContent.trim()) {
        void addMessage({
          id: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          content: finalContent,
          createdAt: msg.createdAt,
          model: msg.model,
        });
      }
    });

    setStreamingMessages({});
    streamingMessagesRef.current = {};
    messageIdsRef.current = {};
    setIsStreaming(false);
    completeReasoning();
    setReasoningStartAt(null);
  }, [isStreaming, mockMode, completeReasoning, addMessage, streamingMessages]);

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
