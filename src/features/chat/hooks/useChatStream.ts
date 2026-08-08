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
import { getCurrentProviderAccountId } from "@/features/providers";
import { notifyMemoryUpdated } from "@/features/memory/useConversationMemoryCount";
import { useSettingsStore } from "@/store/settingsStore";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import { agentName, runtimeLabel } from "@/features/runtime/runtime-options";
import type { ModelChoice } from "@/lib/models/model-choice";
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
  setTitleGenerationStatus: (id, status) =>
    useChatStore.getState().actions.setTitleGenerationStatus?.(id, status),
  renameConversation: (id, title, source) =>
    useChatStore.getState().actions.renameConversation(id, title, source),
};

const pendingMemoryUpdates = new Map<string, string[]>();

function validModelChoices(choices: ModelChoice[]): ModelChoice[] {
  return choices.filter((item) => Boolean(item.model && item.provider));
}

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
  modelChoices: ModelChoice[],
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
  const modelChoicesRef = useRef(modelChoices);
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
  useEffect(() => {
    modelChoicesRef.current = modelChoices;
  }, [modelChoices]);
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
    models: ModelChoice[],
  ) => {
    if (!conversationId) return;
    const runtime = useRuntimeStore.getState().selected;
    if (!runtime || runtime.kind === "unresolved") {
      notify.error("Chat unavailable", "Choose a model connection first");
      return;
    }
    if (runtime.kind === "chat-model" && !models.length) return;
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
    const targets = runtime.kind === "coding-agent"
      ? [{
        model: runtime.model_id ?? agentName(runtime.agent_kind),
        provider: undefined,
      }]
      : models;
    const created = targets.map(({ model, provider }): ChatJob => {
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
      return {
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
        // Null is the legacy value: preserve existing users' terminal access
        // until they explicitly choose an onboarding capability level.
        terminalEnabled: runtime.kind === "chat-model" && capabilityMode !== "chat-only",
        token: getSessionToken,
      };
    });
    setStreamingConversationId(conversationId);
    setJobs((current) => [...current, ...created]);
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
      const models = validModelChoices(modelChoicesRef.current);
      const runtime = useRuntimeStore.getState().selected;
      if (!models.length && runtime?.kind !== "coding-agent") return;
      store.actions.dequeueMessage(next.id);
      const user = await addMessage({
        id: crypto.randomUUID(),
        conversationId: next.conversationId,
        role: "user",
        content: next.content,
        attachments: next.attachments,
      });
      void extractUserMessageMemory(next.conversationId, user.id, models[0]?.model);
      await startStream(next.conversationId, models);
    } finally {
      processingQueueRef.current = false;
    }
  }, [addMessage, startStream]);
  processNextInQueueRef.current = processNextInQueue;

  const sendMessage = useCallback(async (
    content: string,
    attachments?: Attachment[],
  ) => {
    const models = validModelChoices(modelChoices);
    const runtime = useRuntimeStore.getState().selected;
    if (
      (!content.trim() && !attachments?.length) ||
      (!models.length && runtime?.kind !== "coding-agent")
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
    void extractUserMessageMemory(conversationId, user.id, models[0]?.model);
    await startStream(conversationId, models);
  }, [activeConversationId, addMessage, modelChoices, notify, startStream]);

  const stopStreaming = useCallback(async () => {
    if (!jobsRef.current.length) return;
    setJobs((current) => current.map((job) => ({ ...job, cancelled: true })));
    clearQueue();
  }, [clearQueue]);

  const regenerateMessage = useCallback((conversationId: string) => {
    const models = validModelChoices(modelChoices);
    const runtime = useRuntimeStore.getState().selected;
    if (
      jobsRef.current.length ||
      (!models.length && runtime?.kind !== "coding-agent") ||
      !conversationId
    ) return;
    void startStream(conversationId, models);
  }, [modelChoices, startStream]);

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
