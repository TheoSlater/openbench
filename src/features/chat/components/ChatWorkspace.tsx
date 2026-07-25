import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Box } from "@/components/ui/Box";
import { useShallow } from "zustand/react/shallow";
import { ChatArea } from "@/features/chat/components/ChatArea";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { EmptyState } from "@/features/chat/components/EmptyState";
import { Header } from "@/features/chat/components/Header";
import { useChatStream } from "@/features/chat/hooks/useChatStream";
import { useChatStore } from "@/store/chatStore";
import { useModelStore } from "@/store/modelStore";
import type { ModelProvider } from "@/store/modelStore";
import type { ModelChoice } from "@/lib/models/model-choice";
import { modelChoiceId } from "@/lib/models/model-choice";
import { materializeAttachments, releaseImageAttachment } from "@/lib/image-upload/attachments";
import { useFolderStore } from "@/store/folderStore";
import { FolderHome } from "@/features/folders/FolderHome";
import { useOllama } from "@/features/ollama";
import { useAgentRun } from "@/features/agent/useAgentRun";
import { DRAFT_WORKSPACE_SELECTION_CHAT_ID, useAgentStore } from "@/features/agent/agentStore";
import { useSettingsStore } from "@/store/settingsStore";
import { buildAgentResolvedContext } from "@/features/agent/context";
import { useViewStore, getViewComponent } from "@/lib/view-registry";
import { useNotify } from "@/hooks/useNotify";

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
  const experimentalFeatures = useSettingsStore((state) => state.general.experimentalFeatures);
  const agentEnabled = useAgentStore((state) => state.enabled) && experimentalFeatures;
  const workspaceSelections = useAgentStore((state) => state.workspaceSelections);
  const setWorkspaceSelection = useAgentStore((state) => state.actions.setSelectedWorkspaceSelection);
  const permissionPreset = useAgentStore((state) => state.permissionPreset);
  const { startAgentRun, cancelAgentRun, agentStatus } = useAgentRun({
    selectedModelChoices,
  });
  const isAgentStreaming = ["running", "waiting_for_approval", "cancelling"].includes(agentStatus);
  const effectiveStreaming = isStreaming || isAgentStreaming;

  const { activeConversationId, currentAttachments, storeMessages } = useChatStore(
    useShallow((state) => ({
      activeConversationId: state.activeConversationId,
      currentAttachments: state.currentAttachments,
      storeMessages: state.messages,
    })),
  );
  const {
    createConversation,
    setActiveConversationId,
    deleteMessagesAfter,
    clearCurrentAttachments,
    addMessage,
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
    onStopStreamingReady(agentEnabled ? cancelAgentRun : stopStreaming);
    return () => onStopStreamingReady(null);
  }, [agentEnabled, cancelAgentRun, onStopStreamingReady, stopStreaming]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await createConversation("New Chat", false, activeFolder?.id);
    return created.id;
  }, [activeConversationId, activeFolder?.id, createConversation]);

  type SubmitMode = "chat" | "agent";

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed && currentAttachments.length === 0) return;
      const conversationId = await ensureConversation();

      const submitMode: SubmitMode = (() => {
        if (!agentEnabled) return "chat";
        return "agent";
      })();

      if (submitMode === "agent") {
        if (!trimmed) return;
        const draftSelection = workspaceSelections[DRAFT_WORKSPACE_SELECTION_CHAT_ID];
        const ws = workspaceSelections[conversationId] ??
          (draftSelection?.type === "project"
            ? draftSelection
            : { type: "sandbox" as const, chatId: conversationId });
        if (!workspaceSelections[conversationId]) {
          setWorkspaceSelection(
            conversationId,
            ws.type === "sandbox"
              ? { type: "sandbox", chatId: conversationId }
              : ws,
          );
        }
        const runSelection =
          ws.type === "sandbox"
            ? { type: "sandbox" as const, chatId: conversationId }
            : ws;
        const workspacePath =
          runSelection.type === "project" ? runSelection.path : undefined;
        const resolvedContext = buildAgentResolvedContext({
          messages: storeMessages,
          prompt: trimmed,
          workspacePath: workspacePath ?? `sandbox:${conversationId}`,
        });
        await addMessage({ conversationId, role: "user", content: trimmed });
        await startAgentRun({
          conversationId,
          prompt: trimmed,
          workspacePath,
          workspaceSelection: runSelection,
          permissionPreset,
          resolvedContext,
        });
        return;
      }

      const attachments = await materializeAttachments([
        ...(activeFolder?.contextFiles ?? []),
        ...currentAttachments,
      ]);
      await sendMessage(trimmed, attachments);
      currentAttachments.forEach(releaseImageAttachment);
      clearCurrentAttachments();
    },
    [
      activeFolder?.contextFiles,
      currentAttachments,
      ensureConversation,
      agentEnabled,
      workspaceSelections,
      setWorkspaceSelection,
      permissionPreset,
      storeMessages,
      addMessage,
      startAgentRun,
      sendMessage,
      clearCurrentAttachments,
    ],
  );

  const handleRegenerate = useCallback(
    async (messageIndex: number) => {
      if (effectiveStreaming || !activeConversationId) return;

      const targetMessage = messages[messageIndex];
      if (targetMessage?.role !== "assistant") return;

      await deleteMessagesAfter(activeConversationId, targetMessage.id);

      if (targetMessage.agent) {
        const userMessage = messages
          .slice(0, messageIndex)
          .reverse()
          .find((m) => m.role === "user");
        const prompt = userMessage?.content ?? targetMessage.agent.request?.prompt ?? "";
        if (!prompt) return;
        const ws = workspaceSelections[activeConversationId] ??
          (targetMessage.agent.workspaceSelection
            ? { ...targetMessage.agent.workspaceSelection }
            : { type: "sandbox" as const, chatId: activeConversationId });
        const workspacePath = targetMessage.agent.workspacePath;
        const resolvedContext = targetMessage.agent.context ?? buildAgentResolvedContext({
          messages: storeMessages,
          prompt,
          workspacePath: workspacePath ?? `sandbox:${activeConversationId}`,
        });
        await startAgentRun({
          conversationId: activeConversationId,
          prompt,
          workspacePath,
          workspaceSelection: ws,
          permissionPreset: targetMessage.agent.permissionPreset ?? permissionPreset,
          resolvedContext,
        });
      } else {
        regenerateMessage(activeConversationId);
      }
    },
    [
      activeConversationId,
      deleteMessagesAfter,
      effectiveStreaming,
      messages,
      regenerateMessage,
      startAgentRun,
      workspaceSelections,
      storeMessages,
      permissionPreset,
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
          onStop={agentEnabled ? cancelAgentRun : stopStreaming}
          isStreaming={effectiveStreaming}
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
              onStop={agentEnabled ? cancelAgentRun : stopStreaming}
              isStreaming={effectiveStreaming}
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
                onStop={agentEnabled ? cancelAgentRun : stopStreaming}
                isStreaming={effectiveStreaming}
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
            onInterrupt={agentEnabled ? cancelAgentRun : stopStreaming}
            canSubmit={
              ollama.online &&
              selectedModelChoices.some((choice) => Boolean(choice.model && choice.provider))
            }
            isResponding={effectiveStreaming}
            messages={messages}
          />
        </Suspense>
      ) : null}
    </Box>
  );
}
