import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, StreamPayload, Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useInspectorStore } from "@/store/inspectorStore";
import { cleanTitle, loggedInvoke } from "@/lib/utils";

type StreamingMessage = {
  id: string;
  role: "assistant";
  content: string;
  conversationId: string;
  createdAt: string;
  model: string;
};

function getTemporalPrompt() {
  const now = new Date();
  return `Temporal Awareness:
- CURRENT_DATE: ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
- CURRENT_TIME: ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
- CURRENT_WEEKDAY: ${now.toLocaleDateString("en-US", { weekday: "long" })}
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

function buildSystemPrompt(userSystemPrompt: string) {
  const temporal = getTemporalPrompt();
  return userSystemPrompt.trim()
    ? `${temporal}\nPersonalization/Custom Instructions:\n${userSystemPrompt}`
    : temporal;
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
  const [streamingMessages, setStreamingMessages] = useState<
    Record<string, StreamingMessage>
  >({});

  const streamingMessagesRef = useRef<Record<string, string>>({});
  const messageIdsRef = useRef<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelStreamRef = useRef(false);
  // Tracks how many model invocations are still in-flight so we know when
  // to clear isStreaming regardless of whether they errored or completed.
  const pendingStreamsRef = useRef(0);
  const getLog = useCallback(
    (requestId: string) =>
      useInspectorStore.getState().logs.find((log) => log.id === requestId),
    [],
  );

  useEffect(() => {
    setStreamingConversationId(isStreaming ? activeConversationId : null);
  }, [isStreaming, activeConversationId, setStreamingConversationId]);

  const resetStreamState = useCallback(() => {
    setStreamingMessages({});
    streamingMessagesRef.current = {};
    messageIdsRef.current = {};
    pendingStreamsRef.current = 0;
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

  const clearStreamingMessage = useCallback((requestId: string) => {
    setStreamingMessages((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    delete streamingMessagesRef.current[requestId];
    delete messageIdsRef.current[requestId];
  }, []);

  const settlePendingStream = useCallback(() => {
    pendingStreamsRef.current -= 1;
    if (pendingStreamsRef.current <= 0) {
      pendingStreamsRef.current = 0;
      setIsStreaming(false);
    }
  }, []);

  const autoRenameConversation = useCallback(
    (conversationId: string, model: string) => {
      const currentMessages = useChatStore.getState().messages;
      const conversation = useChatStore
        .getState()
        .conversations.find((c) => c.id === conversationId);

      if (currentMessages.length > 2 || conversation?.title !== "New Chat") {
        return;
      }

      const userMessage = currentMessages.find((message) => message.role === "user");
      if (!userMessage) return;

      const requestBody = {
        model,
        messages: [
          {
            role: "user",
            content: `Summarize this chat in 2-3 words. Be concise and do not use quotes. Use Title Case.\nText: ${userMessage.content}`,
          },
        ],
      };

      loggedInvoke<string>("chat", requestBody)
        .then((title) => {
          if (title) {
            void renameConversation(conversationId, cleanTitle(title));
          }
        })
        .catch((error) => {
          console.error("Auto-rename failed:", error);
        });
    },
    [renameConversation],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages]);

  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<StreamPayload>(
      "chat-chunk",
      async (event) => {
        if (cancelStreamRef.current || !activeConversationId) return;

        const { request_id, done, content, metadata } = event.payload;

        streamingMessagesRef.current[request_id] =
          (streamingMessagesRef.current[request_id] || "") + content;
        const fullContent = streamingMessagesRef.current[request_id];

        setStreamingMessages((prev) => {
          if (!prev[request_id]) {
            const messageId = crypto.randomUUID();
            messageIdsRef.current[request_id] = messageId;

            const log = getLog(request_id);
            if (log && !log.timing.firstTokenTime) {
              updateLog(log.id, {
                timing: {
                  ...log.timing,
                  firstTokenTime: Date.now() - log.timing.startTime,
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
                model: log?.model ?? "unknown",
              },
            };
          }
          return {
            ...prev,
            [request_id]: { ...prev[request_id], content: fullContent },
          };
        });

        if (!done) return;

        const messageId = messageIdsRef.current[request_id];
        const log = getLog(request_id);
        const model = log?.model ?? "unknown";

        settlePendingStream();

        if (log) {
          updateLog(log.id, {
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
              ...log.timing,
              totalTime: Date.now() - log.timing.startTime,
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
            autoRenameConversation(activeConversationId, model);
          });
        }

        clearStreamingMessage(request_id);
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    mockMode,
    activeConversationId,
    addMessage,
    autoRenameConversation,
    clearStreamingMessage,
    getLog,
    settlePendingStream,
    updateLog,
  ]);

  useEffect(() => {
    return () => {
      if (mockTimerRef.current) clearTimeout(mockTimerRef.current);
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string, attachments?: Attachment[]) => {
      const models = selectedModels.filter(Boolean);
      if (!content.trim() || isStreaming || (models.length === 0 && !mockMode))
        return;

      cancelStreamRef.current = false;
      const conversationId =
        useChatStore.getState().activeConversationId ?? activeConversationId;
      if (!conversationId) return;

      const processedContent = processTemporalVariables(content.trim());
      await addMessage({
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
        pendingStreamsRef.current = 1;
        mockTimerRef.current = setTimeout(
          () => {
            pendingStreamsRef.current = 0;
            setIsStreaming(false);
            void addMessage({
              id: crypto.randomUUID(),
              conversationId,
              role: "assistant",
              content: `Mock response: ${processedContent}`,
              createdAt: new Date().toISOString(),
              model: "mock-model",
            });
          },
          600 + Math.round(Math.random() * 400),
        );
        return;
      }

      const finalSystemPrompt = buildSystemPrompt(systemPrompt);
      pendingStreamsRef.current = models.length;

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
          timing: { startTime: Date.now() },
        });

        invoke("chat_stream", requestBody).catch((error) => {
          console.error(`Chat error for model ${model}:`, error);

          settlePendingStream();

          void addMessage({
            id: crypto.randomUUID(),
            conversationId,
            role: "assistant",
            content:
              typeof error === "string" && error.includes("not found")
                ? `Model "${model}" not found. Please pull the model or select a different one.`
                : `Failed to connect to Ollama for model ${model}. Error: ${error}`,
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
      settlePendingStream,
    ],
  );

  const stopStreaming = useCallback(async () => {
    if (!isStreaming) return;
    cancelStreamRef.current = true;

    try {
      await loggedInvoke("cancel_chat");
    } catch (err) {
      console.error("Failed to cancel chat:", err);
    }

    if (mockMode && mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }

    Object.values(streamingMessages).forEach((msg) => {
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
