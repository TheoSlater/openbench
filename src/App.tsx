import { useEffect, useState, useCallback, useDeferredValue, useMemo } from "react";
import { useChatStream, useModelPicker, useSystemPrompts } from "@/hooks";
import { Header, ChatArea, EmptyState, ChatInput } from "@/components/Chat";
import { InspectorPanel } from "@/components/Inspector/InspectorPanel";
import { useModelStore } from "@/store/modelStore";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
} from "@/components/Layout/Sidebar";
import { SettingsModal } from "@/components/Settings/SettingsModal";
import { Box, Snackbar, Alert } from "@mui/material";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useToolStore } from "@/store/toolStore";
import { AuthModal } from "@/components/Auth/AuthModal";
import ToolApproval from "@/components/Chat/ToolApproval";
import type { ChatMessage } from "@/types/chat";
import { useShallow } from "zustand/react/shallow";
import "./App.css";
import * as db from "@/lib/db";

function measureAsyncInteraction<T>(
  _name: string,
  _metadata: Record<string, unknown> | undefined,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(fn());
}

function measureSyncInteraction<T>(
  _name: string,
  _metadata: Record<string, unknown> | undefined,
  fn: () => T,
): T {
  return fn();
}

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: "",
  });
  const {
    availableModels,
    selectedModels,
    updateSelectedModel,
    addSelectedModel,
    removeSelectedModel,
    isLoading,
    ollamaError,
    pullingModel,
    pullProgress,
    systemPrompts,
    activeSystemPromptId,
    setSystemPrompt,
    setDefaultModel,
  } = useModelStore(
    useShallow((state) => ({
      availableModels: state.availableModels,
      selectedModels: state.selectedModels,
      updateSelectedModel: state.updateSelectedModel,
      addSelectedModel: state.addSelectedModel,
      removeSelectedModel: state.removeSelectedModel,
      isLoading: state.isLoading,
      ollamaError: state.ollamaError,
      pullingModel: state.pullingModel,
      pullProgress: state.pullProgress,
      systemPrompts: state.systemPrompts,
      activeSystemPromptId: state.activeSystemPromptId,
      setSystemPrompt: state.actions.setSystemPrompt,
      setDefaultModel: state.actions.setDefaultModel,
    })),
  );

  const selectedModel = selectedModels[0] ?? "";

  useModelPicker();
  useSystemPrompts();

  useEffect(() => {
    async function init() {
      try {
        await db.initDB().catch(() => {});
        await Promise.all([
          Promise.race([
            useSettingsStore.getState().actions.syncToBackend(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Timeout syncing settings")),
                3000,
              ),
            ),
          ]).catch(() => {}),
          useAuthStore
            .getState()
            .actions.restoreSession()
            .catch(() => {}),
          useChatStore
            .getState()
            .actions.loadConversations()
            .catch(() => {}),
          useToolStore
            .getState()
            .actions.loadTools()
            .catch(() => {}),
        ]);
      } finally {
        const { isLoading } = useAuthStore.getState();
        if (isLoading) {
          useAuthStore.setState({ isLoading: false });
        }
      }
    }
    init();
  }, []);

  const handleOpenSettings = () => setIsSettingsOpen(true);
  const handleCloseSettings = () => setIsSettingsOpen(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setIsSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const activeSystemPrompt = useMemo(
    () => systemPrompts.find((p) => p.id === activeSystemPromptId) ?? null,
    [systemPrompts, activeSystemPromptId],
  );

  const systemPromptContent = activeSystemPrompt?.content ?? "";

  const {
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages,
  } = useChatStream(selectedModels, systemPromptContent);
  const deferredMessages = useDeferredValue(messages);
  const { conversations, activeConversationId, currentAttachments } = useChatStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      currentAttachments: state.currentAttachments,
    })),
  );
  const user = useAuthStore((state) => state.user);
  const {
    createConversation,
    setActiveConversationId,
    deleteConversation,
    renameConversation,
    deleteMessagesAfter,
    clearCurrentAttachments,
  } = useChatStore((state) => state.actions);

  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await createConversation("New Chat", false);
    return created.id;
  };

  const handleSend = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed && currentAttachments.length === 0) return;
    if (!selectedModel) return;
    await ensureConversation();
    sendMessage(trimmed, currentAttachments);
    clearCurrentAttachments();
  }, [selectedModel, currentAttachments, sendMessage, clearCurrentAttachments]);

  const handleRegenerate = useCallback(async (messageIndex: number) => {
    await measureAsyncInteraction("app.handleRegenerate", { messageIndex }, async () => {
      if (isStreaming || !activeConversationId) return;

      const targetMessage = messages[messageIndex];
      if (targetMessage?.role !== "assistant") return;

      let previousUserMessage: ChatMessage | null = null;
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") {
          previousUserMessage = messages[i];
          break;
        }
      }

      if (!previousUserMessage) return;

      await deleteMessagesAfter(activeConversationId, targetMessage.id);
      sendMessage(previousUserMessage.content);
    });
  }, [activeConversationId, deleteMessagesAfter, isStreaming, messages, sendMessage]);

  const handleNewChat = (isTemporary = false) => {
    measureSyncInteraction("app.handleNewChat", { isTemporary }, () => {
      stopStreaming();

      if (isTemporary) {
        void createConversation("Temporary Chat", true);
        return;
      }

      setActiveConversationId(null);
    });
  };

  const handleSelectConversation = (id: string) => {
    measureSyncInteraction("app.handleSelectConversation", { id }, () => {
      stopStreaming();
      setActiveConversationId(id);
    });
  };

  const handleDeleteConversation = async (id: string) => {
    await measureAsyncInteraction(
      "app.handleDeleteConversation",
      { id },
      async () => {
        stopStreaming();
        await deleteConversation(id);
      },
    );
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    await measureAsyncInteraction(
      "app.handleRenameConversation",
      { id, titleLength: newTitle.length },
      async () => {
        await renameConversation(id, newTitle);
      },
    );
  };

  const handleSetDefaultModel = (model: string) => {
    setDefaultModel(model);
    setToast({ open: true, message: `${model} set as default` });
  };

  const handleCloseToast = () => setToast({ ...toast, open: false });

  const isTemporary = Boolean(conversations.find((c) => c.id === activeConversationId)?.isTemporary);

  const handleToggleTemporaryChat = async () => {
    await measureAsyncInteraction("app.handleToggleTemporaryChat", { isTemporary }, async () => {
      if (isStreaming) stopStreaming();

      if (isTemporary) {
        setActiveConversationId(null);
        return;
      }

      await createConversation("Temporary Chat", true);
    });
  };

  return (
    <SidebarProvider>
      <Sidebar
        onOpenSettings={handleOpenSettings}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        conversations={conversations}
        activeConversationId={activeConversationId}
        collapsible="icon"
      />

      <SidebarInset>
        <Header
          selectedModels={selectedModels}
          availableModels={availableModels}
          onModelChange={updateSelectedModel}
          onAddModel={() =>
            addSelectedModel("ollama", availableModels.ollama[0]?.name || "")
          }
          onRemoveModel={removeSelectedModel}
          isLoading={isLoading}
          ollamaError={ollamaError}
          onSetDefault={handleSetDefaultModel}
          onToggleInspector={() => setIsInspectorOpen((v) => !v)}
          isInspectorOpen={isInspectorOpen}
          isTemporary={isTemporary}
          onToggleTemporaryChat={handleToggleTemporaryChat}
          pullingModel={pullingModel}
          pullProgress={pullProgress}
          systemPrompts={systemPrompts}
          activeSystemPromptId={activeSystemPromptId}
          onSystemPromptChange={setSystemPrompt}
        />

        <Box
          component="main"
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
            position: "relative",
            bgcolor: "background.default",
            pt: "56px",
          }}
        >
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              justifyContent: "flex-start",
              transition: (theme) =>
                theme.transitions.create("margin", {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.leavingScreen,
                }),
              marginRight: isInspectorOpen ? "0px" : "-350px",
              width: "100%",
            }}
          >
            {hasMessages ? (
              <ChatArea
                messages={deferredMessages}
                bottomRef={bottomRef}
                onRegenerate={handleRegenerate}
                isTemporary={isTemporary}
              />
            ) : (
              <EmptyState
                selectedModels={selectedModels}
                userName={user?.fullName || user?.email}
                isTemporary={isTemporary}
              >
                <ChatInput
                  onSubmit={handleSend}
                  onStop={stopStreaming}
                  isStreaming={isStreaming}
                  selectedModel={selectedModel}
                  hasMessages={hasMessages}
                  isTemporary={isTemporary}
                />
              </EmptyState>
            )}

            {hasMessages && (
              <ChatInput
                onSubmit={handleSend}
                onStop={stopStreaming}
                isStreaming={isStreaming}
                selectedModel={selectedModel}
                hasMessages={hasMessages}
                isTemporary={isTemporary}
              />
            )}
          </Box>
          <InspectorPanel
            open={isInspectorOpen}
            onClose={() => setIsInspectorOpen(false)}
          />
        </Box>
      </SidebarInset>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleCloseSettings} />
      <AuthModal />
      <ToolApproval />

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={handleCloseToast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleCloseToast}
          severity="success"
          sx={{
            width: "100%",
            bgcolor: "background.paper",
            color: "text.primary",
            border: (theme) => `1px solid ${theme.palette.border?.main}`,
            "& .MuiAlert-icon": { color: "success.main" },
          }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </SidebarProvider>
  );
}

export default App;
