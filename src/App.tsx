import { useEffect, useState } from "react";
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
import "./App.css";
import * as db from "@/lib/db";

function App() {
  const [input, setInput] = useState("");
  const [devMode, setDevMode] = useState(false);
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
    actions: modelActions,
  } = useModelStore();

  const selectedModel = selectedModels[0] || "";

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

  const activeSystemPrompt =
    systemPrompts.find((prompt) => prompt.id === activeSystemPromptId) ?? null;

  const effectiveSystemPrompt = activeSystemPrompt?.content ?? "";

  const {
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages,
  } = useChatStream(selectedModels, devMode, effectiveSystemPrompt);
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  );
  const user = useAuthStore((state) => state.user);
  const {
    createConversation,
    setActiveConversationId,
    addMessage,
    deleteConversation,
    renameConversation,
    deleteMessagesAfter,
    clearCurrentAttachments,
  } = useChatStore((state) => state.actions);

  const currentAttachments = useChatStore((state) => state.currentAttachments);

  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await createConversation("New Chat", false);
    return created.id;
  };

  const handleDevCommand = async (command: string) => {
    const [, arg] = command.trim().split(/\s+/);
    let nextValue = devMode;

    if (arg === "on") {
      nextValue = true;
    } else if (arg === "off") {
      nextValue = false;
    } else if (arg === "help") {
      const conversationId = await ensureConversation();
      await addMessage({
        conversationId,
        role: "user",
        content: command,
      });
      await addMessage({
        conversationId,
        role: "assistant",
        content: "Usage: /dev [on|off] — toggles mock responses.",
      });
      return;
    } else {
      nextValue = !devMode;
    }

    setDevMode(nextValue);
    const conversationId = await ensureConversation();
    await addMessage({
      conversationId,
      role: "user",
      content: command,
    });
    await addMessage({
      conversationId,
      role: "assistant",
      content: nextValue
        ? "Developer mode enabled. Responses are mocked."
        : "Developer mode disabled. Using the AI backend.",
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed && currentAttachments.length === 0) return;
    if (trimmed.startsWith("/dev")) {
      await handleDevCommand(trimmed);
      setInput("");
      return;
    }
    if (!selectedModel && !devMode) {
      return;
    }
    await ensureConversation();
    sendMessage(trimmed, currentAttachments);
    setInput("");
    clearCurrentAttachments();
  };

  const handleRegenerate = async (messageIndex: number) => {
    if (isStreaming || !activeConversationId) return;

    let previousUserMessage: ChatMessage | null = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        previousUserMessage = messages[i];
        break;
      }
    }

    const targetMessage = messages[messageIndex];
    if (!previousUserMessage || targetMessage?.role !== "assistant") return;

    await deleteMessagesAfter(activeConversationId, targetMessage.id);
    sendMessage(previousUserMessage.content);
  };

  const handleNewChat = (isTemporary = false) => {
    stopStreaming();
    if (isTemporary) {
      void createConversation("Temporary Chat", true);
    } else {
      setActiveConversationId(null);
    }
  };

  const handleSelectConversation = (id: string) => {
    stopStreaming();
    setActiveConversationId(id);
  };

  const handleDeleteConversation = async (id: string) => {
    stopStreaming();
    await deleteConversation(id);
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    await renameConversation(id, newTitle);
  };

  const handleSetDefaultModel = (model: string) => {
    modelActions.setDefaultModel(model);
    setToast({ open: true, message: `${model} set as default` });
  };

  const handleCloseToast = () => {
    setToast({ ...toast, open: false });
  };

  const isTemporary = !!conversations.find((c) => c.id === activeConversationId)
    ?.isTemporary;

  const handleToggleTemporaryChat = async () => {
    if (isStreaming) stopStreaming();

    if (isTemporary) {
      // Switch back to a new chat when disabling temporary chat
      setActiveConversationId(null);
    } else {
      // If not temporary, start a new temporary chat
      await createConversation("Temporary Chat", true);
    }
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
                messages={messages}
                bottomRef={bottomRef}
                onRegenerate={handleRegenerate}
                isTemporary={isTemporary}
              />
            ) : (
              <EmptyState
                selectedModels={devMode ? ["Dev Mode"] : selectedModels}
                userName={user?.fullName || user?.email}
                isTemporary={isTemporary}
              >
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => handleSend()}
                  onStop={stopStreaming}
                  isStreaming={isStreaming}
                  selectedModel={devMode ? "Dev Mode" : selectedModel}
                  hasMessages={hasMessages}
                  allowEmptyModel={devMode}
                  isTemporary={isTemporary}
                />
              </EmptyState>
            )}

            {hasMessages && (
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSend()}
                onStop={stopStreaming}
                isStreaming={isStreaming}
                selectedModel={devMode ? "Dev Mode" : selectedModel}
                hasMessages={hasMessages}
                allowEmptyModel={devMode}
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
