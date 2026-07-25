import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Box } from "@/components/ui/Box";
import { useShallow } from "zustand/react/shallow";
import { ChatArea } from "@/features/chat/components/ChatArea";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { EmptyState } from "@/features/chat/components/EmptyState";
import { Header } from "@/features/chat/components/Header";
import { useChatStream } from "@/features/chat/hooks/useChatStream";
import { NEW_CHAT_DRAFT_KEY, useChatStore } from "@/store/chatStore";
import { useModelStore } from "@/store/modelStore";
import type { ModelProvider } from "@/store/modelStore";
import type { ModelChoice } from "@/lib/models/model-choice";
import { modelChoiceId } from "@/lib/models/model-choice";
import { materializeAttachments, releaseImageAttachment } from "@/lib/image-upload/attachments";
import { useFolderStore } from "@/store/folderStore";
import { FolderHome } from "@/features/folders/FolderHome";
import { useOllama } from "@/features/ollama";
import { useViewStore, getViewComponent } from "@/lib/view-registry";
import { useNotify } from "@/hooks/useNotify";
import { useConfirmStore } from "@/store/confirmStore";

const EMPTY_ATTACHMENTS: never[] = [];

const VoiceModeOverlayLazy = lazy(() =>
  import("@/features/chat/components/VoiceModeOverlay"),
);

type ChatWorkspaceProps = {
  selectedModels: string[];
  selectedProviders: ModelProvider[];
  selectedModelChoices: ModelChoice[];
  systemPromptContent: string;
  userName?: string;
  isTemporary: boolean;
  onStopStreamingReady: (stopStreaming: (() => void) | null) => void;
  onOpenConnections: () => void;
};

export default function ChatWorkspace({
  selectedModels,
  selectedProviders,
  selectedModelChoices,
  systemPromptContent,
  userName,
  isTemporary,
  onStopStreamingReady,
  onOpenConnections,
}: ChatWorkspaceProps) {
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const ollama = useOllama();
  const notify = useNotify();
  const activeFolder = useFolderStore((state) => state.folders.find((folder) => folder.id === state.activeFolderId));
  const effectiveSystemPrompt = activeFolder?.systemPrompt
    ? `${systemPromptContent}\n${activeFolder.systemPrompt}`
    : systemPromptContent;
  const { messages, isStreaming, sendMessage, regenerateMessage, stopStreaming, bottomRef, hasMessages } =
    useChatStream(selectedModelChoices, effectiveSystemPrompt, voiceModeOpen);
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

  const modelUpdateSelectedModel = useModelStore((s) => s.updateSelectedModel);
  const modelAddSelectedModel = useModelStore((s) => s.addSelectedModel);
  const modelRemoveSelectedModel = useModelStore((s) => s.removeSelectedModel);
  const modelActions = useModelStore((s) => s.actions);

  const handleSetDefault = useCallback(
    (choice: ModelChoice) => {
      if (!choice.model) return;
      modelActions.setDefaultModel(
        modelChoiceId(choice.provider, choice.model, choice.providerConfigId),
      );
      notify.success(`${choice.model} set as default`);
    },
    [modelActions, notify],
  );

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
    return created.id;
  }, [activeConversationId, activeFolder?.id, createConversation]);

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed && currentAttachments.length === 0) return;
      await ensureConversation();
      const attachments = await materializeAttachments([
        ...(activeFolder?.contextFiles ?? []),
        ...currentAttachments,
      ]);
      await sendMessage(trimmed, attachments);
      currentAttachments.forEach(releaseImageAttachment);
      clearAttachments(chatKey);
    },
    [
      activeFolder?.contextFiles,
      chatKey,
      currentAttachments,
      ensureConversation,
      sendMessage,
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
        regenerateMessage(activeConversationId);
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
      regenerateMessage,
    ],
  );

  const activeView = useViewStore((s) => s.activeView);
  const ViewComponent = activeView ? getViewComponent(activeView) : undefined;

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
      {/* Full voice mode is opaque over the workspace — skip rendering the
          chat UI behind it so streaming markdown re-renders don't starve the
          orb animation. Compact voice mode shows the chat, with the voice bar
          replacing the composer. */}
      {voiceModeOpen && !voiceCompact ? null : ViewComponent ? (
        <ViewComponent />
      ) : (
        <>
          <Header
        selectedModels={selectedModels}
        selectedProviders={selectedProviders}
        selectedModelChoices={selectedModelChoices}
        onModelChange={modelUpdateSelectedModel}
        onAddModel={() => modelAddSelectedModel("OllamaLocal", "")}
        onRemoveModel={modelRemoveSelectedModel}
        onSetDefault={handleSetDefault}
        isTemporary={isTemporary}
        onToggleTemporaryChat={handleToggleTemporary}
      />

      {activeFolder && !activeConversationId ? (
        <FolderHome
          folder={activeFolder}
          onSubmit={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          providerOnline={ollama.online}
          onOpenConnections={onOpenConnections}
          onOpenVoiceMode={openVoiceMode}
        />
      ) : hasMessages ? (
        <ChatArea
          key={activeConversationId ?? "no-conv"}
          messages={messages}
          bottomRef={bottomRef}
          onRegenerate={handleRegenerate}
          isTemporary={isTemporary}
        />
      ) : (
        <EmptyState
          selectedModels={selectedModels}
          userName={userName}
          isTemporary={isTemporary}
          providerOnline={ollama.online}
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
              ollama.online &&
              selectedModelChoices.some((choice) => Boolean(choice.model && choice.provider))
            }
            isResponding={isStreaming}
            messages={messages}
          />
        </Suspense>
      ) : null}
    </Box>
  );
}
