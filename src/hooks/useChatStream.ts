import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useInspectorStore } from "@/store/inspectorStore";
import { useToolStore } from "@/store/toolStore";
import { cleanTitle, loggedInvoke } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// Payload emitted by the Rust backend on the "chat-chunk" event.
// `done` signals the final chunk; `metadata` carries token counts etc.
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

// Payload emitted by the Rust backend on the "chat-thinking" event.
// Sent whenever the model's native thinking field changes in a stream chunk.
type ThinkingPayload = {
  request_id: string;
  thinking: string;
  is_thinking: boolean;
};

// Payload emitted by the Rust backend when a tool is invoked.
type ToolInvocationPayload = {
  invocation_id: string;
  request_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  requires_approval: boolean;
};

// ---------------------------------------------------------------------------
// Temporal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Core hook for managing LLM chat streaming via Tauri events.
 *
 * Handles:
 *  - Multi-model concurrent streaming (one request per selected model)
 *  - Native thinking/reasoning blocks emitted by the Rust backend
 *  - Message persistence via the chat store + auto-rename on first exchange
 *  - Cancellation, mock mode, and inspector logging
 *
 * @param selectedModels  Ollama model names to send each message to
 * @param mockMode        If true, returns a fake response after a short delay
 * @param systemPrompt    User-defined system prompt; temporal context is prepended automatically
 */
export function useChatStream(
  selectedModels: string[],
  mockMode = false,
  systemPrompt = "",
) {
  // ------ Store bindings --------------------------------------------------
  const messages = useChatStore((s) => s.messages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const { addMessage, renameConversation, setStreamingConversationId } =
    useChatStore((s) => s.actions);
  const { addLog, updateLog } = useInspectorStore((s) => s.actions);

  // ------ Local state -----------------------------------------------------
  const [isStreaming, setIsStreaming] = useState(false);

  // Keyed by request_id. Holds live in-progress assistant messages so the UI
  // can render partial output without touching the persisted store yet.
  const [streamingMessages, setStreamingMessages] = useState<
    Record<string, StreamingMessage>
  >({});

  // ------ Refs (avoid stale closures in event listeners) ------------------

  // Accumulated raw content per request_id (source of truth for content)
  const contentAccRef = useRef<Record<string, string>>({});
  // Accumulated thinking per request_id
  const thinkingAccRef = useRef<Record<string, string>>({});
  // Stable message IDs so the same UUID is used from first chunk → persist
  const messageIdsRef = useRef<Record<string, string>>({});
  // Track when thinking started for each request
  const thinkingStartTimeRef = useRef<Record<string, number>>({});
  // Track when thinking ended for each request
  const thinkingEndTimeRef = useRef<Record<string, number>>({});
  // How many model streams are still in-flight
  const pendingStreamsRef = useRef(0);
  // Set to true when we want to ignore incoming events (conversation switch / stop)
  const cancelRef = useRef(false);
  // Timer handle for mock mode
  const mockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Scroll anchor
  const bottomRef = useRef<HTMLDivElement>(null);

  // ------ Derived state ---------------------------------------------------

  // Expose combined persisted + live messages to the UI
  const displayMessages = useMemo<ChatMessage[]>(() => {
    const live = Object.values(streamingMessages);
    if (live.length === 0) return messages;
    
    // Filter out any persisted messages that are currently being streamed 
    // (to avoid duplicates during the transition from live -> persisted)
    const liveIds = new Set(live.map((m) => m.id));
    const persisted = messages.filter((m) => !liveIds.has(m.id));
    
    return [...persisted, ...live];
  }, [messages, streamingMessages]);

  // ------ Helpers ---------------------------------------------------------

  /** Get an inspector log entry by request_id (read direct from store) */
  const getLog = useCallback(
    (requestId: string) =>
      useInspectorStore.getState().logs.find((l) => l.id === requestId),
    [],
  );

  /** Remove a streaming message and its associated refs */
  const clearStreamingMessage = useCallback((requestId: string) => {
    setStreamingMessages((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    delete contentAccRef.current[requestId];
    delete messageIdsRef.current[requestId];
    delete thinkingAccRef.current[requestId];
    delete thinkingStartTimeRef.current[requestId];
    delete thinkingEndTimeRef.current[requestId];
  }, []);

  /** Decrement pending count; clear isStreaming when all streams finish */
  const settlePending = useCallback(() => {
    pendingStreamsRef.current = Math.max(0, pendingStreamsRef.current - 1);
    if (pendingStreamsRef.current === 0) {
      setIsStreaming(false);
    }
  }, []);

  /** Reset all transient streaming state (used on cancel / conversation switch) */
  const resetStreamState = useCallback(() => {
    setStreamingMessages({});
    contentAccRef.current = {};
    thinkingAccRef.current = {};
    messageIdsRef.current = {};
    thinkingStartTimeRef.current = {};
    thinkingEndTimeRef.current = {};
    pendingStreamsRef.current = 0;
  }, []);

  /** Try to auto-rename the conversation based on the first user message */
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

  // ------ Effects ---------------------------------------------------------

  // Keep the store's streamingConversationId in sync
  useEffect(() => {
    setStreamingConversationId(isStreaming ? activeConversationId : null);
  }, [isStreaming, activeConversationId, setStreamingConversationId]);

  // Cancel any active stream when the user switches conversations
  useEffect(() => {
    cancelRef.current = true;
    if (mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }
    resetStreamState();
    setIsStreaming(false);
  }, [activeConversationId, resetStreamState]);

  // Scroll to bottom whenever visible messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages]);

  // Cleanup mock timer on unmount
  useEffect(() => {
    return () => {
      if (mockTimerRef.current) clearTimeout(mockTimerRef.current);
    };
  }, []);

  // ------ Event listener: chat-chunk --------------------------------------
  // The Rust backend emits this for every content delta (and once with done=true
  // at the end of each model's stream). The thinking content is emitted
  // separately on "chat-thinking" below — this event only carries response text.
  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<ChunkPayload>(
      "chat-chunk",
      async (event) => {
        if (cancelRef.current || !activeConversationId) return;

        const { request_id, content, done, metadata } = event.payload;

        // Accumulate content (backend already strips thinking tokens before emitting here)
        contentAccRef.current[request_id] =
          (contentAccRef.current[request_id] ?? "") + content;
        const fullContent = contentAccRef.current[request_id];

        if (!done) {
          // Mid-stream: update the live streaming message
          setStreamingMessages((prev) => {
            const existing = prev[request_id];

            if (!existing) {
              // First chunk for this request — allocate a stable ID and record TTFT
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
                ...prev,
                [request_id]: {
                  id: messageId,
                  role: "assistant",
                  content: fullContent,
                  thinking: thinkingAccRef.current[request_id],
                  isThinking: true,
                  conversationId: activeConversationId,
                  createdAt: new Date().toISOString(),
                  model: log?.model ?? "unknown",
                },
              };
            }

            return {
              ...prev,
              [request_id]: { ...existing, content: fullContent },
            };
          });
          return;
        }

        // ---- Stream complete (done = true) ---------------------------------
        const messageId =
          messageIdsRef.current[request_id] ?? crypto.randomUUID();
        messageIdsRef.current[request_id] = messageId;

        const log = getLog(request_id);
        const model = log?.model ?? "unknown";

        // Finalise inspector log
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

        // Persist to store (only if there's something worth saving)
        const thinking = thinkingAccRef.current[request_id];
        const endTime = thinkingEndTimeRef.current[request_id] || Date.now();
        const thinkingDuration = thinkingStartTimeRef.current[request_id] 
          ? (endTime - thinkingStartTimeRef.current[request_id]) / 1000 
          : undefined;

        if (fullContent.trim() || thinking?.trim()) {
          await addMessage({
            id: messageId,
            conversationId: activeConversationId,
            role: "assistant",
            content: fullContent,
            thinking,
            thinkingDuration,
            isThinking: false,
            createdAt: new Date().toISOString(),
            model,
          });
          autoRenameConversation(activeConversationId, model);
        }

        settlePending();
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
    settlePending,
    updateLog,
  ]);

  // ------ Event listener: chat-thinking -----------------------------------
  // The Rust backend emits accumulated thinking content here whenever the
  // model's native `thinking` field has new data in a stream chunk.
  // This uses the Ollama API's first-class thinking support — no tag parsing.
  useEffect(() => {
    if (mockMode) return;

    const unlistenPromise = listen<ThinkingPayload>(
      "chat-thinking",
      async (event) => {
        if (cancelRef.current || !activeConversationId) return;

        const { request_id, thinking, is_thinking } = event.payload;

        // Keep the ref up to date (used when persisting the final message)
        thinkingAccRef.current[request_id] = thinking;

        setStreamingMessages((prev) => {
          const existing = prev[request_id];

          // Capture end time when thinking concludes
          if (!is_thinking && thinkingStartTimeRef.current[request_id] && !thinkingEndTimeRef.current[request_id]) {
            thinkingEndTimeRef.current[request_id] = Date.now();
          }

          if (!existing) {
            // Thinking arrived before the first content chunk — create the
            // streaming message now so the UI can show the thinking indicator.
            thinkingStartTimeRef.current[request_id] = Date.now();
            const messageId =
              messageIdsRef.current[request_id] ?? crypto.randomUUID();
            messageIdsRef.current[request_id] = messageId;

            const log = getLog(request_id);
            return {
              ...prev,
              [request_id]: {
                id: messageId,
                role: "assistant",
                content: "",
                thinking,
                isThinking: is_thinking,
                conversationId: activeConversationId,
                createdAt: new Date().toISOString(),
                model: log?.model ?? "unknown",
              },
            };
          }

          return {
            ...prev,
            [request_id]: { ...existing, thinking, isThinking: is_thinking },
          };
        });
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [mockMode, activeConversationId, getLog]);

  // ------ Event listener: tool-invocation ----------------------------------
  // This listener handles events sent by the Rust backend whenever a tool
  // is triggered by the LLM.
  // 
  // FLOW:
  // 1. Rust backend identifies a tool call in the model response.
  // 2. Rust emits "tool-invocation" event.
  // 3. Frontend catches it here, updates the UI with a status indicator,
  //    and if the tool requires approval, triggers the ToolApproval modal via the toolStore.
  useEffect(() => {
    if (mockMode) return;

    const { setPendingApproval } = useToolStore.getState().actions;

    const unlistenPromise = listen<ToolInvocationPayload>(
      "tool-invocation",
      (event) => {
        const { request_id, tool_name, tool_args, requires_approval, invocation_id } =
          event.payload;

        // Visual feedback: show the user that a tool is being used
        setStreamingMessages((prev) => {
          const existing = prev[request_id];
          if (existing) {
            const toolLabel = `\n\n🔧 Using tool: **${tool_name}**...`;
            return {
              ...prev,
              [request_id]: {
                ...existing,
                content: existing.content + toolLabel,
              },
            };
          }
          return prev;
        });

        // Backend blocks execution if requires_approval is true, waiting for
        // the "approve_tool" command from the frontend.
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
  }, [mockMode]);

  // ------ sendMessage -----------------------------------------------------
  const sendMessage = useCallback(
    async (content: string, attachments?: Attachment[]) => {
      const models = selectedModels.filter(Boolean);
      if (
        !content.trim() ||
        isStreaming ||
        (models.length === 0 && !mockMode)
      ) {
        return;
      }

      cancelRef.current = false;
      const conversationId =
        useChatStore.getState().activeConversationId ?? activeConversationId;
      if (!conversationId) return;

      const processedContent = processTemporalVariables(content.trim());

      // Persist the user message first
      await addMessage({
        conversationId,
        role: "user",
        content: processedContent,
        attachments,
      });

      // Snapshot the full history (now including the new user message)
      const history = useChatStore.getState().messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments ?? [],
      }));

      setIsStreaming(true);
      resetStreamState();

      // ---- Mock mode -------------------------------------------------------
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

      // ---- Real streaming --------------------------------------------------
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

        invoke("chat_stream", requestBody).catch((error: unknown) => {
          console.error(`Stream error for ${model}:`, error);
          settlePending();

          const errorMsg =
            typeof error === "string" && error.includes("not found")
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
    [
      selectedModels,
      isStreaming,
      mockMode,
      systemPrompt,
      activeConversationId,
      addMessage,
      addLog,
      resetStreamState,
      settlePending,
    ],
  );

  // ------ stopStreaming ----------------------------------------------------
  const stopStreaming = useCallback(async () => {
    if (!isStreaming) return;

    cancelRef.current = true;

    try {
      await loggedInvoke("cancel_chat");
    } catch (err) {
      console.error("Failed to cancel chat:", err);
    }

    if (mockMode && mockTimerRef.current) {
      clearTimeout(mockTimerRef.current);
      mockTimerRef.current = null;
    }

    // Persist whatever partial content we've accumulated so it isn't lost
    const snapshot = { ...streamingMessages };
    for (const msg of Object.values(snapshot)) {
      if (msg.content.trim() || msg.thinking?.trim()) {
        const thinkingDuration = thinkingStartTimeRef.current[msg.id] 
          ? (Date.now() - thinkingStartTimeRef.current[msg.id]) / 1000 
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
    }

    resetStreamState();
    setIsStreaming(false);
  }, [isStreaming, mockMode, streamingMessages, addMessage, resetStreamState]);

  // Public API
  return {
    messages: displayMessages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages: displayMessages.length > 0,
  };
}
