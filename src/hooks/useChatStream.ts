import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload, Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useInspectorStore } from "@/store/inspectorStore";

const MAIN_SYSTEM_PROMPT = `You are a highly capable AI assistant. Be clear, concise, and direct.

- Use Markdown formatting where appropriate (headers, bold, lists, tables, code blocks with language labels).
- Use KaTeX for math: inline with $...$ and display with $$...$$.
- Break down complex problems step by step.
- If a request is ambiguous, ask one clarifying question before proceeding.`;

function getTemporalPrompt() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  return `Temporal Awareness:
- CURRENT_DATE: ${date}
- CURRENT_TIME: ${time}
- CURRENT_WEEKDAY: ${weekday}
`;
}

function processTemporalVariables(content: string) {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  return content
    .replace(/\{\{CURRENT_DATE\}\}/g, date)
    .replace(/\{\{CURRENT_TIME\}\}/g, time)
    .replace(/\{\{CURRENT_WEEKDAY\}\}/g, weekday);
}

export function useChatStream(
  selectedModels: string[],
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

  const [streamingMessages, setStreamingMessages] = useState<
    Record<
      string,
      {
        id: string;
        role: "assistant";
        content: string;
        conversationId: string;
        createdAt: string;
        model: string;
      }
    >
  >({});

  const streamingMessagesRef = useRef<Record<string, string>>({});
  const messageIdsRef = useRef<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelStreamRef = useRef(false);

  const resetStreamState = useCallback(() => {
    setStreamingMessages({});
    streamingMessagesRef.current = {};
    messageIdsRef.current = {};
  }, []);

  useEffect(() => {
    cancelStreamRef.current = true;
    if (mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    resetStreamState();
    setIsStreaming(false);
  }, [activeConversationId, resetStreamState]);

  const displayMessages = useMemo<ChatMessage[]>(() => {
    const streamList = Object.values(streamingMessages);
    if (streamList.length === 0) return messages;
    return [...messages, ...streamList];
  }, [messages, streamingMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages]);

  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<StreamPayload>(
      "chat-chunk",
      async (event) => {
        if (cancelStreamRef.current) return;
        if (!activeConversationId) return;

        const { request_id, done, content, metadata } = event.payload;

        streamingMessagesRef.current[request_id] =
          (streamingMessagesRef.current[request_id] || "") + content;
        const fullContent = streamingMessagesRef.current[request_id];

        setStreamingMessages((prev) => {
          if (!prev[request_id]) {
            const messageId = crypto.randomUUID();
            messageIdsRef.current[request_id] = messageId;

            const lastLog = useInspectorStore
              .getState()
              .logs.find((l) => l.id === request_id);
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
                content: fullContent,
                conversationId: activeConversationId,
                createdAt: new Date().toISOString(),
                model,
              },
            };
          }

          return {
            ...prev,
            [request_id]: { ...prev[request_id], content: fullContent },
          };
        });

        if (done) {
          const messageId = messageIdsRef.current[request_id];
          const model =
            useInspectorStore.getState().logs.find((l) => l.id === request_id)
              ?.model || "unknown";

          const remainingStreams = Object.keys(
            streamingMessagesRef.current,
          ).filter((id) => id !== request_id);
          if (remainingStreams.length === 0) {
            setIsStreaming(false);
          }

          const lastLog = useInspectorStore
            .getState()
            .logs.find((l) => l.id === request_id);
          if (lastLog) {
            updateLog(lastLog.id, {
              response: {
                status: 200,
                headers: {},
                body: {
                  message: { role: "assistant", content: fullContent },
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

          if (fullContent.trim() && messageId) {
            void addMessage({
              id: messageId,
              conversationId: activeConversationId,
              role: "assistant",
              content: fullContent,
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
                    model,
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

          setStreamingMessages((prev) => {
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
    activeConversationId,
    addMessage,
    streamingMessages,
    renameConversation,
    updateLog,
  ]);

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
      const models = selectedModels.filter((m) => !!m);
      if (
        !content.trim() ||
        isStreaming ||
        (models.length === 0 && !mockMode)
      ) {
        return;
      }

      cancelStreamRef.current = false;
      const conversationId =
        useChatStore.getState().activeConversationId ?? activeConversationId;
      if (!conversationId) return;

      const processedContent = processTemporalVariables(content.trim());

      void addMessage({
        conversationId,
        role: "user",
        content: processedContent,
        attachments,
      });

      const history = useChatStore.getState().messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments || [],
      }));

      setIsStreaming(true);
      resetStreamState();

      if (mockMode) {
        if (mockTimerRef.current) clearTimeout(mockTimerRef.current);
        const delayMs = 600 + Math.round(Math.random() * 400);
        mockTimerRef.current = setTimeout(() => {
          const createdAt = new Date().toISOString();
          const messageId = crypto.randomUUID();
          setIsStreaming(false);
          void addMessage({
            id: messageId,
            conversationId,
            role: "assistant",
            content: `Mock response: ${processedContent}`,
            createdAt,
            model: "mock-model",
          });
        }, delayMs);
        return;
      }

      const temporalPrompt = getTemporalPrompt();
      const baseSystemPrompt = `${MAIN_SYSTEM_PROMPT}\n${temporalPrompt}`;
      const finalSystemPrompt = systemPrompt.trim()
        ? `${baseSystemPrompt}\n\nPersonalization/Custom Instructions:\n${systemPrompt}`
        : baseSystemPrompt;

      for (const model of models) {
        const request_id = crypto.randomUUID();
        const requestBody = {
          requestId: request_id,
          model,
          messages: history,
          systemPrompt: finalSystemPrompt,
        };

        addLog({
          id: request_id,
          model,
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

        invoke("chat_stream", requestBody).catch((error) => {
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
      mockMode,
      systemPrompt,
      activeConversationId,
      addMessage,
      addLog,
      resetStreamState,
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
    Object.values(currentStreams).forEach((msg) => {
      if (msg.content.trim()) {
        void addMessage({
          id: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
          model: msg.model,
        });
      }
    });

    resetStreamState();
    setIsStreaming(false);
  }, [isStreaming, mockMode, addMessage, streamingMessages, resetStreamState]);

  return {
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages: displayMessages.length > 0,
  };
}
