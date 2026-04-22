import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useInspectorStore } from "@/store/inspectorStore";
import { useToolStore } from "@/store/toolStore";
import { cleanTitle, loggedInvoke } from "@/lib/utils";

const STREAM_FLUSH_INTERVAL_MS = 33;

// Break up long tasks to allow input processing
function yieldToMain(): Promise<void> {
  const scheduler = (window as Window & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function afterNextPaint(fn: () => void): void {
  requestAnimationFrame(fn);
}

function estimateJsonBytes(_args: unknown): number {
  return 0;
}

function measureAsyncInteraction<T>(
  _name: string,
  _metadata: Record<string, unknown> | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(fn());
}

function perfLog(..._args: unknown[]): void {}

type StreamingMessage = {
  id: string;
  role: "assistant";
  content: string;
  thinking?: string;
  isThinking?: boolean;
  conversationId: string;
  createdAt: string;
  model: string;
};

type ChunkPayload = {
  request_id: string;
  content: string;
  done: boolean;
  metadata?: {
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_duration?: number;
    eval_duration?: number;
  };
};

type ThinkingPayload = {
  request_id: string;
  thinking: string;
  is_thinking: boolean;
};

type ToolInvocationPayload = {
  invocation_id: string;
  request_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  requires_approval: boolean;
};

function getTemporalPrompt(): string {
  const now = new Date();
  return [
    "Temporal Awareness:",
    `- CURRENT_DATE: ${now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    `- CURRENT_TIME: ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    `- CURRENT_WEEKDAY: ${now.toLocaleDateString("en-US", { weekday: "long" })}`,
  ].join("\n");
}

function processTemporalVariables(content: string): string {
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

function buildSystemPrompt(userSystemPrompt: string): string {
  const temporal = getTemporalPrompt();
  return userSystemPrompt.trim()
    ? `${temporal}\nPersonalization/Custom Instructions:\n${userSystemPrompt}`
    : temporal;
}

export function useChatStream(selectedModels: string[], systemPrompt = "") {
  const messages = useChatStore((s) => s.messages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const { addMessage, renameConversation, setStreamingConversationId } =
    useChatStore((s) => s.actions);
  const { addLog, updateLog } = useInspectorStore((s) => s.actions);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<
    Record<string, StreamingMessage>
  >({});

  const contentAccRef = useRef<Record<string, string>>({});
  const thinkingAccRef = useRef<Record<string, string>>({});
  const messageIdsRef = useRef<Record<string, string>>({});
  const thinkingStartTimeRef = useRef<Record<string, number>>({});
  const thinkingEndTimeRef = useRef<Record<string, number>>({});
  const pendingStreamsRef = useRef(0);
  const cancelRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const streamingMessagesRef = useRef<Record<string, StreamingMessage>>({});
  const flushScheduledRef = useRef(false);
  const flushTimeoutRef = useRef<number | null>(null);
  const chunkCounterRef = useRef(0);

  const displayMessages = useMemo<ChatMessage[]>(() => {
    const live = Object.values(streamingMessages);
    if (live.length === 0) return messages;

    const liveIds = new Set(live.map((m) => m.id));
    const persisted = messages.filter((m) => !liveIds.has(m.id));

    return persisted.length === 0 ? live : [...persisted, ...live];
  }, [messages, streamingMessages]);

  const getLog = useCallback(
    (requestId: string) =>
      useInspectorStore.getState().logs.find((l) => l.id === requestId),
    [],
  );

  const flushStreamingMessages = useCallback(() => {
    flushScheduledRef.current = false;
    if (flushTimeoutRef.current !== null) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }

    startTransition(() => {
      setStreamingMessages({ ...streamingMessagesRef.current });
    });
  }, []);

  const scheduleStreamingFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    flushTimeoutRef.current = window.setTimeout(() => {
      flushStreamingMessages();
    }, STREAM_FLUSH_INTERVAL_MS);
  }, [flushStreamingMessages]);

  const updateStreamingMessage = useCallback(
    (
      requestId: string,
      updater: (current?: StreamingMessage) => StreamingMessage | undefined,
      options?: { flushImmediately?: boolean },
    ) => {
      const nextValue = updater(streamingMessagesRef.current[requestId]);

      if (nextValue) {
        streamingMessagesRef.current = {
          ...streamingMessagesRef.current,
          [requestId]: nextValue,
        };
      } else if (requestId in streamingMessagesRef.current) {
        const nextMessages = { ...streamingMessagesRef.current };
        delete nextMessages[requestId];
        streamingMessagesRef.current = nextMessages;
      }

      if (options?.flushImmediately) {
        flushStreamingMessages();
        return;
      }

      scheduleStreamingFlush();
    },
    [flushStreamingMessages, scheduleStreamingFlush],
  );

  const clearStreamingMessage = useCallback(
    (requestId: string, options?: { flushImmediately?: boolean }) => {
      updateStreamingMessage(requestId, () => undefined, options);
      delete contentAccRef.current[requestId];
      delete messageIdsRef.current[requestId];
      delete thinkingAccRef.current[requestId];
      delete thinkingStartTimeRef.current[requestId];
      delete thinkingEndTimeRef.current[requestId];
    },
    [updateStreamingMessage],
  );

  const settlePending = useCallback(() => {
    pendingStreamsRef.current = Math.max(0, pendingStreamsRef.current - 1);
    if (pendingStreamsRef.current === 0) {
      setIsStreaming(false);
    }
  }, []);

  const resetStreamState = useCallback(() => {
    if (flushTimeoutRef.current !== null) {
      window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    flushScheduledRef.current = false;
    streamingMessagesRef.current = {};
    setStreamingMessages({});
    contentAccRef.current = {};
    thinkingAccRef.current = {};
    messageIdsRef.current = {};
    thinkingStartTimeRef.current = {};
    thinkingEndTimeRef.current = {};
    pendingStreamsRef.current = 0;
    chunkCounterRef.current = 0;
  }, []);

  const autoRenameConversation = useCallback(
    (conversationId: string, model: string) => {
      const storeState = useChatStore.getState();
      const convo = storeState.conversations.find(
        (c) => c.id === conversationId,
      );
      if (storeState.messages.length > 2 || convo?.title !== "New Chat") return;

      const userMsg = storeState.messages.find((m) => m.role === "user");
      if (!userMsg) return;

      loggedInvoke<string>("chat", {
        model,
        messages: [
          {
            role: "user",
            content: `Summarize this chat in 2-3 words. Be concise and do not use quotes. Use Title Case.\nText: ${userMsg.content}`,
          },
        ],
      })
        .then((title) => {
          if (title) void renameConversation(conversationId, cleanTitle(title));
        })
        .catch((err) => console.error("Auto-rename failed:", err));
    },
    [renameConversation],
  );

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    setStreamingConversationId(isStreaming ? activeConversationId : null);
  }, [isStreaming, activeConversationId, setStreamingConversationId]);

  useEffect(() => {
    cancelRef.current = true;
    resetStreamState();
    setIsStreaming(false);
  }, [activeConversationId, resetStreamState]);

  useEffect(() => {
    afterNextPaint(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
  }, [displayMessages]);

  useEffect(() => {
    const unlistenPromise = listen<ChunkPayload>(
      "chat-chunk",
      async (event) => {
        const conversationId = activeConversationIdRef.current;
        if (cancelRef.current || !conversationId) return;

        const { request_id, content, done, metadata } = event.payload;
        chunkCounterRef.current += 1;
        if (chunkCounterRef.current % 12 === 0) {
          await yieldToMain();
        }

        contentAccRef.current[request_id] =
          (contentAccRef.current[request_id] ?? "") + content;
        const fullContent = contentAccRef.current[request_id];

        if (!done) {
          updateStreamingMessage(request_id, (existing) => {
            if (existing) {
              return { ...existing, content: fullContent };
            }

            const messageId =
              messageIdsRef.current[request_id] ?? crypto.randomUUID();
            messageIdsRef.current[request_id] = messageId;

            const log = getLog(request_id);
            if (log && !log.timing?.firstTokenTime) {
              updateLog(log.id, {
                timing: {
                  ...log.timing,
                  firstTokenTime: Date.now() - log.timing.startTime,
                },
              });
            }

            return {
              id: messageId,
              role: "assistant",
              content: fullContent,
              thinking: thinkingAccRef.current[request_id],
              isThinking: true,
              conversationId,
              createdAt: new Date().toISOString(),
              model: log?.model ?? "unknown",
            };
          });
          return;
        }

        const messageId =
          messageIdsRef.current[request_id] ?? crypto.randomUUID();
        messageIdsRef.current[request_id] = messageId;

        const log = getLog(request_id);
        const model = log?.model ?? "unknown";

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
                  input: metadata.prompt_eval_count ?? 0,
                  output: metadata.eval_count ?? 0,
                }
              : undefined,
            timing: {
              ...log.timing,
              totalTime: Date.now() - log.timing.startTime,
            },
          });
        }

        const thinking = thinkingAccRef.current[request_id];
        const hasContent = fullContent.trim().length > 0;
        const hasThinking = thinking?.trim().length > 0;

        if (hasContent || hasThinking) {
          const startTime = thinkingStartTimeRef.current[request_id];
          const endTime = thinkingEndTimeRef.current[request_id] || Date.now();
          const thinkingDuration = startTime
            ? (endTime - startTime) / 1000
            : undefined;

          await addMessage({
            id: messageId,
            conversationId,
            role: "assistant",
            content: fullContent,
            thinking,
            thinkingDuration,
            isThinking: false,
            createdAt: new Date().toISOString(),
            model,
          });
          autoRenameConversation(conversationId, model);
        }

        settlePending();
        clearStreamingMessage(request_id, { flushImmediately: true });
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    addMessage,
    autoRenameConversation,
    clearStreamingMessage,
    getLog,
    settlePending,
    updateLog,
    updateStreamingMessage,
  ]);

  useEffect(() => {
    const unlistenPromise = listen<ThinkingPayload>(
      "chat-thinking",
      async (event) => {
        const conversationId = activeConversationIdRef.current;
        if (cancelRef.current || !conversationId) return;

        const { request_id, thinking, is_thinking } = event.payload;
        thinkingAccRef.current[request_id] = thinking;

        updateStreamingMessage(request_id, (existing) => {
          const hasStarted = Boolean(thinkingStartTimeRef.current[request_id]);
          const hasEnded = Boolean(thinkingEndTimeRef.current[request_id]);
          if (!is_thinking && hasStarted && !hasEnded) {
            thinkingEndTimeRef.current[request_id] = Date.now();
          }

          if (existing) {
            return { ...existing, thinking, isThinking: is_thinking };
          }

          thinkingStartTimeRef.current[request_id] = Date.now();
          const messageId =
            messageIdsRef.current[request_id] ?? crypto.randomUUID();
          messageIdsRef.current[request_id] = messageId;

          const log = getLog(request_id);
          return {
            id: messageId,
            role: "assistant",
            content: "",
            thinking,
            isThinking: is_thinking,
            conversationId,
            createdAt: new Date().toISOString(),
            model: log?.model ?? "unknown",
          };
        });
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [getLog, updateStreamingMessage]);

  useEffect(() => {
    const { setPendingApproval } = useToolStore.getState().actions;

    const unlistenPromise = listen<ToolInvocationPayload>(
      "tool-invocation",
      (event) => {
        const {
          request_id,
          tool_name,
          tool_args,
          requires_approval,
          invocation_id,
        } = event.payload;

        updateStreamingMessage(request_id, (existing) => {
          if (!existing) return existing;

          const toolLabel = `\n\nTool: **${tool_name}**`;
          return {
            ...existing,
            content: existing.content.endsWith(toolLabel)
              ? existing.content
              : existing.content + toolLabel,
          };
        });

        if (requires_approval) {
          setPendingApproval({
            invocationId: invocation_id,
            requestId: request_id,
            toolName: tool_name,
            toolArgs: tool_args,
          });
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [updateStreamingMessage]);

  const sendMessage = useCallback(
    async (content: string, attachments?: Attachment[]) => {
      const models = selectedModels.filter(Boolean);
      const hasContent = content.trim().length > 0;
      const hasAttachments = (attachments?.length ?? 0) > 0;

      if (
        (!hasContent && !hasAttachments) ||
        isStreaming ||
        models.length === 0
      ) {
        return;
      }

      const conversationId =
        useChatStore.getState().activeConversationId ?? activeConversationId;
      if (!conversationId) return;

      await measureAsyncInteraction(
        "chat.sendMessage",
        {
          selectedModels: models.length,
          attachmentCount: attachments?.length ?? 0,
        },
        async () => {
          cancelRef.current = false;
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
            attachments: m.attachments ?? [],
          }));

          setIsStreaming(true);
          resetStreamState();

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

            perfLog("stream-payload", "chat_stream.request", {
              model,
              messageCount: history.length,
              payloadBytes: estimateJsonBytes(requestBody),
            });

            const invokeStart = performance.now();
            invoke("chat_stream", requestBody).catch((error: unknown) => {
              perfLog(
                "tauri-invoke",
                "chat_stream",
                {
                  model,
                  payloadBytes: estimateJsonBytes(requestBody),
                  error: String(error),
                },
                performance.now() - invokeStart,
              );
              console.error(`Stream error for ${model}:`, error);
              settlePending();

              const isModelNotFound =
                typeof error === "string" && error.includes("not found");
              const errorMsg = isModelNotFound
                ? `Model "${model}" not found. Pull it first or pick a different model.`
                : `Failed to connect to Ollama for model ${model}. Error: ${String(error)}`;

              void addMessage({
                id: crypto.randomUUID(),
                conversationId,
                role: "assistant",
                content: errorMsg,
                createdAt: new Date().toISOString(),
                model,
              });
            });
          }
        },
      );
    },
    [
      selectedModels,
      isStreaming,
      systemPrompt,
      activeConversationId,
      addMessage,
      addLog,
      resetStreamState,
      settlePending,
    ],
  );

  const stopStreaming = useCallback(async () => {
    if (!isStreaming) return;

    await measureAsyncInteraction("chat.stopStreaming", undefined, async () => {
      cancelRef.current = true;

      try {
        await loggedInvoke("cancel_chat");
      } catch (err) {
        console.error("Failed to cancel chat:", err);
      }

      const snapshot = { ...streamingMessagesRef.current };
      for (const [requestId, msg] of Object.entries(snapshot)) {
        const hasContent = msg.content.trim().length > 0;
        const hasThinking = (msg.thinking?.trim().length ?? 0) > 0;
        if (!hasContent && !hasThinking) continue;

        const startTime = thinkingStartTimeRef.current[requestId];
        const thinkingDuration = startTime
          ? (Date.now() - startTime) / 1000
          : undefined;

        void addMessage({
          id: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          content: msg.content,
          thinking: msg.thinking,
          thinkingDuration,
          isThinking: false,
          createdAt: msg.createdAt,
          model: msg.model,
        });
      }

      resetStreamState();
      setIsStreaming(false);
    });
  }, [addMessage, isStreaming, resetStreamState]);

  return {
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages: displayMessages.length > 0,
  };
}
