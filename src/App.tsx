import { useEffect, useState } from "react";
import { useChatStream, useModelPicker, useSystemPrompts } from "@/hooks";
import { Header, ChatArea, EmptyState, ChatInput } from "@/components/Chat";
import { InspectorPanel } from "@/components/Inspector/InspectorPanel";
import { modelSupportsReasoning } from "@/lib/model-utils";
import { useModelStore } from "@/store/modelStore";
import { Sidebar, SidebarInset, SidebarProvider } from "@/components/Layout/Sidebar";
import { SettingsModal } from "@/components/Settings/SettingsModal";
import { Box, Snackbar, Alert } from "@mui/material";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { AuthModal } from "@/components/Auth/AuthModal";
import "./App.css";
import * as db from "@/lib/db";
/**
 * Root application shell and layout.
 */
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
    selectedModel,
    setSelectedModel,
    isLoading,
    ollamaError,
    systemPrompts,
    activeSystemPromptId,
    actions: modelActions,
  } = useModelStore();

  useModelPicker();
  useSystemPrompts();

  // const { actions } = useChatStore();

  useEffect(() => {
    async function init() {
      console.log("[App] init starting...");
      
      // Set a global timeout as a safety net
      const timeoutId = setTimeout(() => {
        const { isLoading } = useAuthStore.getState();
        if (isLoading) {
          console.warn("[App] Initialization timeout reached, forcing useAuthStore.isLoading to false");
          useAuthStore.setState({ isLoading: false });
        }
      }, 8000); // 8 seconds global safety timeout

      try {
        // Step 1: Initialize Database
        console.log("[App] initializing DB...");
        try {
          await db.initDB();
        } catch (dbErr) {
          console.error("[App] DB init failed:", dbErr);
        }

        // Step 2: Sync settings to backend
        // This is important for the Ollama client configuration
        console.log("[App] syncing settings to backend...");
        try {
          // Add a per-step timeout to prevent hanging
          await Promise.race([
            useSettingsStore.getState().actions.syncToBackend(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout syncing settings")), 3000))
          ]);
        } catch (settingsErr) {
          console.error("[App] Settings sync failed or timed out:", settingsErr);
        }

        // Step 3: Restore session
        // This MUST run to show the profile
        console.log("[App] restoring session...");
        try {
          await useAuthStore.getState().actions.restoreSession();
        } catch (authErr) {
          console.error("[App] Session restoration failed:", authErr);
        }

        // Step 4: Load conversations
        console.log("[App] loading conversations...");
        try {
          await useChatStore.getState().actions.loadConversations();
        } catch (chatErr) {
          console.error("[App] Loading conversations failed:", chatErr);
        }

        console.log("[App] init sequence finished");
      } catch (err) {
        console.error("[App] Unexpected init error:", err);
      } finally {
        clearTimeout(timeoutId);
        // Ensure isLoading is false if we finished the sequence (successfully or with errors)
        const { isLoading } = useAuthStore.getState();
        if (isLoading) {
          useAuthStore.setState({ isLoading: false });
        }
      }
    }
    init();
  }, []);

  /**
   * Open the settings modal.
   */
  const handleOpenSettings = () => setIsSettingsOpen(true);
  /**
   * Close the settings modal.
   */
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

  const supportsReasoning = devMode || modelSupportsReasoning(selectedModel);
  const activeSystemPrompt =
    systemPrompts.find((prompt) => prompt.id === activeSystemPromptId) ?? null;

  const {
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
    bottomRef,
    hasMessages,
  } = useChatStream(
    selectedModel,
    supportsReasoning,
    devMode,
    activeSystemPrompt?.content ?? "",
  );
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  );
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

  /**
   * Ensure a conversation exists before sending a message.
   */
  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const created = await createConversation();
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

  /**
   * Submit the current input as a message.
   */
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

  /**
   * Regenerate a specific assistant response.
   * @param messageIndex - Index of the assistant message to regenerate.
   */
  const handleRegenerate = async (messageIndex: number) => {
    if (isStreaming || !activeConversationId) return;
    const previousUserMessage = [...messages]
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === "user");
    const targetMessage = messages[messageIndex];
    if (!previousUserMessage || targetMessage?.role !== "assistant") return;

    // Delete the assistant response and any following messages
    await deleteMessagesAfter(activeConversationId, targetMessage.id);
    sendMessage(previousUserMessage.content);
  };

  const handleNewChat = () => {
    stopStreaming();
    setActiveConversationId(null);
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
          selectedModel={selectedModel}
          availableModels={availableModels}
          onModelChange={setSelectedModel}
          isLoading={isLoading}
          ollamaError={ollamaError}
          onSetDefault={handleSetDefaultModel}
          onToggleInspector={() => setIsInspectorOpen((v) => !v)}
          isInspectorOpen={isInspectorOpen}
        />

        <Box component="main" sx={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", position: "relative", bgcolor: "background.default", pt: "56px" }}>
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
            }}
          >
            {hasMessages ? (
              <ChatArea
                messages={messages}
                bottomRef={bottomRef}
                onRegenerate={handleRegenerate}
              />
            ) : (
              <EmptyState selectedModel={devMode ? "Dev Mode" : selectedModel}>
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSend}
                  onStop={stopStreaming}
                  isStreaming={isStreaming}
                  selectedModel={devMode ? "Dev Mode" : selectedModel}
                  hasMessages={hasMessages}
                  allowEmptyModel={devMode}
                />
              </EmptyState>
            )}

            {hasMessages && (
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={handleSend}
                onStop={stopStreaming}
                isStreaming={isStreaming}
                selectedModel={devMode ? "Dev Mode" : selectedModel}
                hasMessages={hasMessages}
                allowEmptyModel={devMode}
              />
            )}
          </Box>
          <InspectorPanel open={isInspectorOpen} onClose={() => setIsInspectorOpen(false)} />
        </Box>
      </SidebarInset>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleCloseSettings} />
      <AuthModal />

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
