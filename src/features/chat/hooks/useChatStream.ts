import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import type { Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { sanitizeOutput } from "@/lib/chat/sanitize";
import { getSessionToken } from "@/lib/utils/utils";
import { useNotify } from "@/hooks/useNotify";
import { buildSystemPrompt } from "@/lib/chat/prompts";
import { VOICE_SYSTEM_PROMPT_SUFFIX } from "@/lib/constants/promptPresets";
import { isFeatureAIActive } from "@/lib/featureRegistry";
import { defaultPreprocessor } from "@/lib/chat/message-preprocessor";
import { triggerTitleGeneration, type TitleStore } from "@/lib/chat/title-generation";
import { getRepository } from "@/lib/repositories";
import { getCurrentProviderAccountId, toLegacyProviderType } from "@/features/providers";
import { notifyMemoryUpdated } from "@/features/memory/useConversationMemoryCount";
import { useSettingsStore } from "@/store/settingsStore";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import { agentName, runtimeIsAvailable, runtimeLabel } from "@/features/runtime/runtime-options";
import { useRuntimeCatalogStore } from "@/features/runtime/catalog-store";
import { fromUIMessage, toUIMessage, filterPartsForRuntime, type PolyUIMessage } from "@/lib/ai/messages";
import {
  closeReasonings,
  createReasoningTimings,
  observeReasoningParts,
  reasoningDurations,
  type ReasoningTiming,
} from "@/lib/chat/reasoning-timing";
import { ChatRuntime, type ChatJob } from "@/features/chat/runtime/ChatRuntime";
import { connectionsClient } from "@/features/connections/client";
import { handleAiTerminalParts } from "@/features/viewport/aiTerminal";

const titleStore: TitleStore = {
  findConversation: (id) => useChatStore.getState().conversations.find((c) => c.id === id),
  getConversationMessages: (id) => useChatStore.getState().messages.filter((m) => m.conversationId === id),
  loadConversationMessages: (id) => getRepository().getMessages(id, 50, 0),
  setTitleGenerationStatus: (id, status) =>
    useChatStore.getState().actions.setTitleGenerationStatus?.(id, status),
  renameConversation: (id, title, source) =>
    useChatStore.getState().actions.renameConversation(id, title, source),
};

const pendingMemoryUpdates = new Map<string, string[]>();

async function extractUserMessageMemory(
  conversationId: string,
  userMessageId: string,
  chatModel?: string,
) {
  pendingMemoryUpdates.delete(conversationId);
  if (!useSettingsStore.getState().general.memoryBeta) return;
  const ownerId = getCurrentProviderAccountId();
  if (!ownerId) return;
  try {
    const summaries = await invoke<string[]>("memory_extract_user_message", {
      ownerId,
      conversationId,
      userMessageId,
      chatModel: chatModel ?? null,
      token: getSessionToken(),
    });
    if (!summaries.length) return;
    pendingMemoryUpdates.set(conversationId, summaries);
    notifyMemoryUpdated();
    const { streamingMessages, actions } = useChatStore.getState();
    const active = Object.values(streamingMessages).filter(
      (message) => message.conversationId === conversationId,
    );
    if (active.length) {
      for (const message of active) {
        actions.patchStreamingMessage(message.id, { memoryUpdates: summaries });
      }
    } else {
      actions.attachMemoryUpdates(conversationId, userMessageId, summaries);
    }
  } catch (error) {
    console.error("[Memory] user message extraction failed", error);
  }
}

type Timing = {
  startedAt: number;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
  reasonings: Map<number, ReasoningTiming>;
};

export function useChatStream(
  systemPrompt = "",
  voiceMode = false,
) {
  const { messages, activeConversationId } = useChatStore(
    useShallow((state) => ({
      messages: state.messages,
      activeConversationId: state.activeConversationId,
    })),
  );
  const addMessage = useChatStore((state) => state.actions.addMessage);
  const setStreamingConversationId = useChatStore(
    (state) => state.actions.setStreamingConversationId,
  );
  const setStreamingMessage = useChatStore((state) => state.actions.setStreamingMessage);
  const patchStreamingMessage = useChatStore(
    (state) => state.actions.patchStreamingMessage,
  );
  const clearQueue = useChatStore((state) => state.actions.clearQueue);
  const notify = useNotify();
  const [jobs, setJobs] = useState<ChatJob[]>([]);
  const jobsRef = useRef(jobs);
  const settled = useRef(new Set<string>());
  const timings = useRef(new Map<string, Timing>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const processingQueueRef = useRef(false);
  const voiceModeRef = useRef(voiceMode);
  const processNextInQueueRef = useRef<
    ((conversationId?: string) => Promise<void>) | undefined
  >(undefined);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  voiceModeRef.current = voiceMode;

  const finishJob = useCallback((job: ChatJob) => {
    setJobs((current) => {
      const next = current.filter((item) => item.requestId !== job.requestId);
      if (!next.length) {
        setStreamingConversationId(null);
        pendingMemoryUpdates.delete(job.conversationId);
        queueMicrotask(() => {
          void processNextInQueueRef.current?.(job.conversationId);
        });
      }
      return next;
    });
  }, [setStreamingConversationId]);

  const handleUpdate = useCallback((job: ChatJob, message: PolyUIMessage) => {
    if (settled.current.has(job.requestId)) return;
    const entity = fromUIMessage(message, {
      conversationId: job.conversationId,
      model: job.model,
      provider: job.provider,
    });
    handleAiTerminalParts(message.parts);
    const now = Date.now();
    const timing = timings.current.get(job.requestId);
    if (timing && entity.thinking && !timing.reasoningStartedAt) {
      timing.reasoningStartedAt = now;
    }
    if (timing?.reasoningStartedAt && entity.content && !timing.reasoningEndedAt) {
      timing.reasoningEndedAt = now;
    }
    if (timing) observeReasoningParts(timing.reasonings, message.parts, now);
    patchStreamingMessage(job.messageId, {
      ...entity,
      id: job.messageId,
      status: "streaming",
      isStreaming: true,
      isThinking: Boolean(entity.thinking && !entity.content),
      thinkingTimings: timing
        ? reasoningDurations(timing.reasonings, now)
        : undefined,
    });
  }, [patchStreamingMessage]);

  const handleFinish = useCallback(async (
    job: ChatJob,
    message: PolyUIMessage,
    state: { aborted: boolean; failed: boolean },
  ) => {
    if (settled.current.has(job.requestId)) return;
    settled.current.add(job.requestId);
    const current = useChatStore.getState().streamingMessages[job.messageId];
    const entity = fromUIMessage(message, {
      conversationId: job.conversationId,
      model: job.model,
      provider: job.provider,
    });
    const timing = timings.current.get(job.requestId);
    const finishedAt = Date.now();
    if (timing) {
      observeReasoningParts(timing.reasonings, message.parts, finishedAt);
      closeReasonings(timing.reasonings, finishedAt);
    }
    const durations = timing
      ? reasoningDurations(timing.reasonings, finishedAt)
      : [];
    const reasoningDuration = timing?.reasoningStartedAt
      ? ((timing.reasoningEndedAt ?? finishedAt) - timing.reasoningStartedAt) / 1000
      : undefined;
    await addMessage({
      ...entity,
      id: job.messageId,
      content: sanitizeOutput(entity.content),
      thinkingDuration: reasoningDuration,
      thinkingTimings: durations.length ? durations : undefined,
      isThinking: false,
      isStreaming: false,
      status: state.aborted ? "aborted" : state.failed ? "error" : "complete",
      memoryUpdates:
        current?.memoryUpdates ?? pendingMemoryUpdates.get(job.conversationId),
    });
    if (job.agent && entity.agentSessionId) {
      // The user may have switched to another runtime while the agent was
      // running; persist the resumed session only when the conversation is
      // still bound to the same agent + workspace, so a mid-stream switch wins.
      const current = await connectionsClient.getRuntime(job.conversationId);
      const bound = current?.kind === "coding-agent"
        && current.installation_id === job.agent.installationId
        && current.agent_kind === job.agent.kind
        && current.workspace_id === job.agent.workspaceId;
      if (bound) {
        const runtime = {
          kind: "coding-agent" as const,
          installation_id: job.agent.installationId,
          agent_kind: job.agent.kind,
          workspace_id: job.agent.workspaceId,
          agent_session_id: entity.agentSessionId,
          model_id: job.agent.modelId ?? null,
        };
        await connectionsClient.setRuntime(job.conversationId, runtime);
        useRuntimeStore.getState().actions.select(runtime, runtimeLabel(runtime));
      }
    }
    setStreamingMessage(job.messageId, null);
    timings.current.delete(job.requestId);
    finishJob(job);
    if (!state.aborted && !state.failed) {
      triggerTitleGeneration(titleStore, job.conversationId);
    }
  }, [addMessage, finishJob, setStreamingMessage]);

  const handleError = useCallback(async (job: ChatJob, error: Error) => {
    if (settled.current.has(job.requestId)) return;
    settled.current.add(job.requestId);
    const current = useChatStore.getState().streamingMessages[job.messageId];
    await addMessage({
      id: job.messageId,
      conversationId: job.conversationId,
      role: "assistant",
      content: sanitizeOutput(current?.content ?? ""),
      thinking: current?.thinking,
      thinkingTimings: current?.thinkingTimings,
      runtimeParts: current?.runtimeParts,
      model: job.model,
      provider: job.provider,
      status: "error",
      errorMessage: error.message,
    });
    setStreamingMessage(job.messageId, null);
    timings.current.delete(job.requestId);
    finishJob(job);
    notify.error(`Chat error (${job.model})`, error.message);
  }, [addMessage, finishJob, notify, setStreamingMessage]);

  const startStream = useCallback(async (
    conversationId: string,
  ) => {
    if (!conversationId) return;
    const runtime = useRuntimeStore.getState().selected;
    if (!runtime || runtime.kind === "unresolved") {
      notify.error("Chat unavailable", "Choose a model connection first");
      return;
    }
    const catalog = useRuntimeCatalogStore.getState();
    if (!runtimeIsAvailable(runtime, catalog.connections, catalog.modelsByConnection, catalog.agents)) {
      notify.error("Chat unavailable", "The selected model is not available. Refresh your connections.");
      return;
    }
    const store = useChatStore.getState();
    const source = conversationId === store.activeConversationId
      ? store.messages.filter((message) => message.conversationId === conversationId)
      : await getRepository().getMessages(conversationId, 50, 0);
    const uiMessages = source.map(toUIMessage).map((message) =>
      filterPartsForRuntime(message, runtime.kind),
    );
    if (!uiMessages.length || uiMessages[uiMessages.length - 1]?.role !== "user") return;

    const webSearchEnabled = isFeatureAIActive("web_search");
    const webSearch = useSettingsStore.getState().general.webSearch;
    const voicePrompt = voiceModeRef.current
      ? `${systemPrompt}\n\n${VOICE_SYSTEM_PROMPT_SUFFIX}`
      : systemPrompt;
    const instructions = buildSystemPrompt(
      voicePrompt,
      webSearchEnabled,
      webSearchEnabled,
    );
    const capabilityMode = useSettingsStore.getState().capabilityMode;
    const model = runtime.kind === "coding-agent"
      ? runtime.model_id ?? agentName(runtime.agent_kind)
      : runtime.model_id;
    const connection = runtime.kind === "chat-model"
      ? catalog.connections.find(({ connection }) => connection.id === runtime.connection_id)?.connection
      : undefined;
    const provider = connection ? toLegacyProviderType(connection.provider) : undefined;
    const requestId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    settled.current.delete(requestId);
    timings.current.set(requestId, {
      startedAt: Date.now(),
      reasonings: createReasoningTimings(),
    });
    setStreamingMessage(messageId, {
      id: messageId,
      conversationId,
      role: "assistant",
      content: "",
      model,
      provider,
      createdAt: new Date().toISOString(),
      status: "streaming",
      isStreaming: true,
    });
    const created: ChatJob = {
      requestId,
      messageId,
      conversationId,
      connectionId: runtime.kind === "chat-model" ? runtime.connection_id : undefined,
      agent: runtime.kind === "coding-agent" ? {
        kind: runtime.agent_kind,
        workspaceId: runtime.workspace_id,
        installationId: runtime.installation_id,
        accessMode: useRuntimeStore.getState().accessMode,
        sessionId: runtime.agent_session_id ?? undefined,
        modelId: runtime.model_id ?? undefined,
      } : undefined,
      model,
      provider,
      messages: uiMessages,
      instructions,
      reasoning: voiceModeRef.current ? "none" : undefined,
      webSearchProvider:
        runtime.kind === "chat-model" && webSearchEnabled ? webSearch.provider : undefined,
      terminalEnabled: runtime.kind === "chat-model" && capabilityMode !== "chat-only",
      token: getSessionToken,
    };
    setStreamingConversationId(conversationId);
    setJobs((current) => [...current, created]);
  }, [notify, setStreamingConversationId, setStreamingMessage, systemPrompt]);

  const processNextInQueue = useCallback(async (completedConversationId?: string) => {
    if (processingQueueRef.current) return;
    const conversationId = completedConversationId ?? activeConversationIdRef.current;
    if (!conversationId) return;
    const store = useChatStore.getState();
    const next = store.actions.getNextQueued(conversationId) ?? store.messageQueue[0];
    if (!next) return;
    processingQueueRef.current = true;
    try {
      const runtime = useRuntimeStore.getState().selected;
      const catalog = useRuntimeCatalogStore.getState();
      if (
        !runtime ||
        runtime.kind === "unresolved" ||
        !runtimeIsAvailable(runtime, catalog.connections, catalog.modelsByConnection, catalog.agents)
      ) return;
      store.actions.dequeueMessage(next.id);
      const user = await addMessage({
        id: crypto.randomUUID(),
        conversationId: next.conversationId,
        role: "user",
        content: next.content,
        attachments: next.attachments,
      });
      const model = runtime.kind === "chat-model" ? runtime.model_id : runtime.model_id ?? agentName(runtime.agent_kind);
      void extractUserMessageMemory(next.conversationId, user.id, model);
      await startStream(next.conversationId);
    } finally {
      processingQueueRef.current = false;
    }
  }, [addMessage, startStream]);
  processNextInQueueRef.current = processNextInQueue;

  const sendMessage = useCallback(async (
    content: string,
    attachments?: Attachment[],
  ) => {
    const runtime = useRuntimeStore.getState().selected;
    const catalog = useRuntimeCatalogStore.getState();
    if (
      (!content.trim() && !attachments?.length) ||
      !runtime ||
      runtime.kind === "unresolved" ||
      !runtimeIsAvailable(runtime, catalog.connections, catalog.modelsByConnection, catalog.agents)
    ) return;
    const conversationId =
      useChatStore.getState().activeConversationId ?? activeConversationId;
    if (!conversationId) return;
    const processed = defaultPreprocessor.preprocess(content.trim());
    if (jobsRef.current.length) {
      useChatStore.getState().actions.enqueueMessage({
        id: crypto.randomUUID(),
        conversationId,
        content: processed,
        attachments,
      });
      return;
    }
    const user = await addMessage({
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: processed,
      attachments,
    });
    const model = runtime.kind === "chat-model" ? runtime.model_id : runtime.model_id ?? agentName(runtime.agent_kind);
    void extractUserMessageMemory(conversationId, user.id, model);
    await startStream(conversationId);
  }, [activeConversationId, addMessage, startStream]);

  const stopStreaming = useCallback(async () => {
    if (!jobsRef.current.length) return;
    setJobs((current) => current.map((job) => ({ ...job, cancelled: true })));
    clearQueue();
  }, [clearQueue]);

  const regenerateMessage = useCallback((conversationId: string) => {
    const runtime = useRuntimeStore.getState().selected;
    const catalog = useRuntimeCatalogStore.getState();
    if (
      jobsRef.current.length ||
      !runtime ||
      !runtimeIsAvailable(runtime, catalog.connections, catalog.modelsByConnection, catalog.agents) ||
      !conversationId
    ) return;
    void startStream(conversationId);
  }, [startStream]);

  const messageQueue = useChatStore((state) => state.messageQueue);
  const queuedCount = useMemo(
    () => messageQueue.filter(
      (message) => message.conversationId === activeConversationId,
    ).length,
    [activeConversationId, messageQueue],
  );
  const runtime = useMemo(
    () => createElement(ChatRuntime, {
      jobs,
      onUpdate: handleUpdate,
      onFinish: handleFinish,
      onError: handleError,
    }),
    [handleError, handleFinish, handleUpdate, jobs],
  );

  return {
    messages,
    isStreaming: jobs.length > 0,
    sendMessage,
    regenerateMessage,
    stopStreaming,
    bottomRef,
    hasMessages: messages.length > 0 || jobs.length > 0,
    queuedCount,
    processNextInQueue,
    runtime,
  };
}
