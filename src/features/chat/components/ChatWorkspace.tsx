import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Box } from "@/components/ui/Box";
import { useShallow } from "zustand/react/shallow";
import { ChatArea } from "@/features/chat/components/ChatArea";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { EmptyState } from "@/features/chat/components/EmptyState";
import { Header } from "@/features/chat/components/Header";
import { useChatStream } from "@/features/chat/hooks/useChatStream";
import { NEW_CHAT_DRAFT_KEY, useChatStore } from "@/store/chatStore";
import type { ModelChoice } from "@/lib/models/model-choice";
import { materializeAttachments, releaseImageAttachment } from "@/lib/image-upload/attachments";
import { useFolderStore } from "@/store/folderStore";
import { FolderHome } from "@/features/folders/FolderHome";
import { useOllama } from "@/features/ollama";
import { useViewStore, getViewComponent } from "@/lib/view-registry";
import { useConfirmStore } from "@/store/confirmStore";
import { AcpActivity } from "@/features/acp/AcpActivity";
import { useAcpChat } from "@/features/acp/useAcpChat";
import { useAcpActivityStore } from "@/features/acp/activity-store";
import { connectionsClient } from "@/features/connections/client";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import { useConnectionsStore } from "@/features/connections/store";
import { getCurrentProviderAccountId, toLegacyProviderType } from "@/features/providers";

const EMPTY_ATTACHMENTS: never[] = [];

const VoiceModeOverlayLazy = lazy(() =>
  import("@/features/chat/components/VoiceModeOverlay"),
);

type ChatWorkspaceProps = {
  systemPromptContent: string;
  userName?: string;
  isTemporary: boolean;
  onStopStreamingReady: (stopStreaming: (() => void) | null) => void;
  onOpenConnections: () => void;
};

export default function ChatWorkspace({
  systemPromptContent,
  userName,
  isTemporary,
  onStopStreamingReady,
  onOpenConnections,
}: ChatWorkspaceProps) {
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const ollama = useOllama();
  const activeFolder = useFolderStore((state) => state.folders.find((folder) => folder.id === state.activeFolderId));
  const effectiveSystemPrompt = activeFolder?.systemPrompt
    ? `${systemPromptContent}\n${activeFolder.systemPrompt}`
    : systemPromptContent;
  const selectedRuntime = useRuntimeStore((state) => state.selected);
  const summaries = useConnectionsStore((state) => state.summaries);
  const loadConnections = useConnectionsStore((state) => state.actions.load);
  const selectedModelChoices = useMemo<ModelChoice[]>(() => {
    if (selectedRuntime?.kind !== "chat-model") return [];
    const connection = summaries.find(
      (item) => item.connection.id === selectedRuntime.connection_id,
    )?.connection;
    if (!connection) return [];
    return [{
      model: selectedRuntime.model_id,
      provider: toLegacyProviderType(connection.provider),
    }];
  }, [selectedRuntime, summaries]);
  const legacyChat = useChatStream(selectedModelChoices, effectiveSystemPrompt, voiceModeOpen);
  const acpChat = useAcpChat();
  const selectedModels = selectedModelChoices.map((choice) => choice.model);
  const selectRuntime = useRuntimeStore((state) => state.actions.select);
  const acpActions = useAcpActivityStore((state) => state.actions);
  const messages = legacyChat.messages;
  const isStreaming = acpChat.isAgent ? acpChat.isStreaming : legacyChat.isStreaming;
  const stopStreaming = acpChat.isAgent ? acpChat.stopStreaming : legacyChat.stopStreaming;
  const bottomRef = legacyChat.bottomRef;
  const hasMessages = legacyChat.hasMessages || Boolean(acpChat.activity) || acpChat.history.length > 0;
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const chatKey = activeConversationId ?? NEW_CHAT_DRAFT_KEY;
  const currentAttachments = useChatStore(
    useShallow((state) => state.attachmentsByChat[chatKey] ?? EMPTY_ATTACHMENTS),
  );
  const {
    createConversation,
    setActiveConversationId,
    deleteMessagesAfter,
    clearAttachments,
  } = useChatStore((state) => state.actions);

  useEffect(() => {
    const accountId = getCurrentProviderAccountId();
    if (accountId) void loadConnections(accountId);
  }, [loadConnections]);

  const handleToggleTemporary = useCallback(() => {
    if (isTemporary) {
      setActiveConversationId(null);
    } else {
      createConversation("Temporary Chat", true);
    }
  }, [isTemporary, createConversation, setActiveConversationId]);
  // Compact voice mode: the orb docks small above the input and the chat
  // stays visible behind it. Toggled by clicking the orb.
  const [voiceCompact, setVoiceCompact] = useState(false);
  const openVoiceMode = useCallback(() => {
    setVoiceCompact(false);
    setVoiceModeOpen(true);
  }, []);
  const closeVoiceMode = useCallback(() => {
    setVoiceModeOpen(false);
    setVoiceCompact(false);
  }, []);
  const toggleVoiceCompact = useCallback(() => setVoiceCompact((c) => !c), []);

  useEffect(() => {
    onStopStreamingReady(stopStreaming);
    return () => onStopStreamingReady(null);
  }, [onStopStreamingReady, stopStreaming]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await createConversation("New Chat", false, activeFolder?.id);
    if (selectedRuntime) {
      await connectionsClient.setRuntime(created.id, selectedRuntime);
    }
    return created.id;
  }, [activeConversationId, activeFolder?.id, createConversation, selectedRuntime]);

  useEffect(() => {
    if (!activeConversationId) return;
    void connectionsClient.getRuntime(activeConversationId).then((runtime) => {
      if (!runtime) return;
      const label = runtime.kind === "chat-model"
        ? runtime.model_id
        : runtime.kind === "coding-agent"
          ? runtime.agent_kind === "codex" ? "Codex" : "Claude Code"
          : "Choose runtime";
      selectRuntime(runtime, label);
    });
  }, [activeConversationId, selectRuntime]);

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed && currentAttachments.length === 0) return;
      const conversationId = await ensureConversation();
      const attachments = await materializeAttachments([
        ...(activeFolder?.contextFiles ?? []),
        ...currentAttachments,
      ]);
      if (acpChat.isAgent) {
        await acpChat.sendMessage(trimmed, attachments, conversationId);
      } else {
        await legacyChat.sendMessage(trimmed, attachments);
      }
      currentAttachments.forEach(releaseImageAttachment);
      clearAttachments(chatKey);
    },
    [
      activeFolder?.contextFiles,
      chatKey,
      currentAttachments,
      ensureConversation,
      acpChat,
      legacyChat,
      clearAttachments,
    ],
  );

  const handleRegenerate = useCallback(
    async (messageIndex: number) => {
      if (isStreaming || !activeConversationId) return;

      const targetMessage = messages[messageIndex];
      if (targetMessage?.role !== "assistant") return;

      const run = async () => {
        await deleteMessagesAfter(activeConversationId, targetMessage.id);
        legacyChat.regenerateMessage(activeConversationId);
      };

      // Regenerating mid-conversation throws away every later message, with
      // no undo. Regenerating the last reply loses nothing, so it stays a
      // one-click action.
      const discarded = messages.length - messageIndex - 1;
      if (discarded <= 0) {
        await run();
        return;
      }

      useConfirmStore.getState().actions.request({
        title: "Regenerate this response?",
        description: `The ${discarded} message${discarded === 1 ? "" : "s"} after it will be permanently deleted.`,
        confirmLabel: "Regenerate",
        destructive: true,
        onConfirm: () => void run(),
      });
    },
    [
      activeConversationId,
      deleteMessagesAfter,
      isStreaming,
      messages,
      legacyChat,
    ],
  );

  const activeView = useViewStore((s) => s.activeView);
  const ViewComponent = activeView ? getViewComponent(activeView) : undefined;
  const activity = acpChat.isAgent ? (
    <div className="flex flex-col gap-4">
      {acpChat.history.map((turn, index) => (
        <AcpActivity
          key={`${turn.sessionId ?? "turn"}-${index}`}
          state={turn}
          onDecision={(requestId, decision) =>
            void acpActions.answer(turn.conversationId, requestId, decision)}
          onReauthenticate={onOpenConnections}
        />
      ))}
      {acpChat.activity ? (
        <AcpActivity
          state={acpChat.activity}
          onDecision={(requestId, decision) =>
            void acpActions.answer(acpChat.activity!.conversationId, requestId, decision)}
          onReauthenticate={onOpenConnections}
        />
      ) : null}
    </div>
  ) : undefined;

  return (
    // No `h-full` here. As a flex child of the workspace row this already fills
    // the cross axis via `align-items: stretch`, and `height: 100%` is actively
    // harmful: WebKitGTK intermittently resolves it against an indefinite
    // containing block, which yields `auto` — and because an explicit height is
    // then set, stretch no longer applies either. The panel collapsed to its
    // content height, leaving a gap under the composer that only a window
    // resize cleared. Stretch has no such dependency.
    <Box
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      {legacyChat.runtime}
      {/* Full voice mode is opaque over the workspace — skip rendering the
          chat UI behind it so streaming markdown re-renders don't starve the
          orb animation. Compact voice mode shows the chat, with the voice bar
          replacing the composer. */}
      {voiceModeOpen && !voiceCompact ? null : ViewComponent ? (
        <ViewComponent />
      ) : (
        <>
      <Header
        onOpenConnections={onOpenConnections}
        isTemporary={isTemporary}
        onToggleTemporaryChat={handleToggleTemporary}
      />

      {activeFolder && !activeConversationId ? (
        <FolderHome
          folder={activeFolder}
          onSubmit={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          providerOnline={acpChat.isAgent || ollama.online}
          onOpenConnections={onOpenConnections}
          onOpenVoiceMode={openVoiceMode}
        />
      ) : hasMessages ? (
        <ChatArea
          key={activeConversationId ?? "no-conv"}
          messages={messages}
          bottomRef={bottomRef}
          onRegenerate={acpChat.isAgent ? undefined : handleRegenerate}
          isTemporary={isTemporary}
          activity={activity}
        />
      ) : (
        <EmptyState
          selectedModels={selectedModels}
          userName={userName}
          isTemporary={isTemporary}
          providerOnline={acpChat.isAgent || ollama.online}
          onOpenConnections={onOpenConnections}
        >
          {voiceModeOpen ? null : (
            <ChatInput
              onSubmit={handleSend}
              onStop={stopStreaming}
              isStreaming={isStreaming}
              isTemporary={isTemporary}
              conversationId={activeConversationId}
              onOpenVoiceMode={openVoiceMode}
            />
          )}
        </EmptyState>
      )}

      {hasMessages ? (
        voiceModeOpen ? (
          // Clearance for the docked voice orb + bar overlaying the bottom.
          <Box className="h-44 shrink-0" />
        ) : (
          <Box className="shrink-0 px-6 pb-6">
            <Box className="mx-auto w-full max-w-3xl">
              <ChatInput
                onSubmit={handleSend}
                onStop={stopStreaming}
                isStreaming={isStreaming}
                isTemporary={isTemporary}
                conversationId={activeConversationId}
                onOpenVoiceMode={openVoiceMode}
              />
            </Box>
          </Box>
        )
      ) : null}
        </>
      )}
      {voiceModeOpen ? (
        <Suspense fallback={null}>
          <VoiceModeOverlayLazy
            open
            compact={voiceCompact}
            onToggleCompact={toggleVoiceCompact}
            onClose={closeVoiceMode}
            onSubmit={handleSend}
            onInterrupt={stopStreaming}
            canSubmit={
              acpChat.isAgent ||
              (ollama.online &&
                selectedModelChoices.some((choice) => Boolean(choice.model && choice.provider)))
            }
            isResponding={isStreaming}
            messages={messages}
          />
        </Suspense>
      ) : null}
    </Box>
  );
}
