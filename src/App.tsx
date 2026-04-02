import { useEffect, useState } from "react";
import { useChatStream, useModelPicker, useSystemPrompts } from "@/hooks";
import { Header, ChatArea, EmptyState, ChatInput } from "@/components/Chat";
import { modelSupportsReasoning } from "@/lib/model-utils";
import { useModelStore } from "@/store/modelStore";
import { Sidebar } from "@/components/Layout/Sidebar";
import { SettingsModal } from "@/components/Settings/SettingsModal";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useChatStore } from "@/store/chatStore";
import "./App.css";

/**
 * Root application shell and layout.
 */
function App() {
  const [input, setInput] = useState("");
  const [devMode, setDevMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    availableModels,
    selectedModel,
    selectedProvider,
    setSelectedModel,
    isLoading,
    ollamaError,
    systemPrompts,
    activeSystemPromptId,
  } = useModelStore();

  useModelPicker();
  useSystemPrompts();

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
  const { createConversation, setActiveConversationId, addMessage } =
    useChatStore((state) => state.actions);

  /**
   * Ensure a conversation exists before sending a message.
   */
  const ensureConversation = () => {
    if (activeConversationId) return activeConversationId;
    const created = createConversation();
    return created.id;
  };

  const handleDevCommand = (command: string) => {
    const [, arg] = command.trim().split(/\s+/);
    let nextValue = devMode;

    if (arg === "on") {
      nextValue = true;
    } else if (arg === "off") {
      nextValue = false;
    } else if (arg === "help") {
      const conversationId = ensureConversation();
      addMessage({
        conversationId,
        role: "user",
        content: command,
      });
      addMessage({
        conversationId,
        role: "assistant",
        content: "Usage: /dev [on|off] — toggles mock responses.",
      });
      return;
    } else {
      nextValue = !devMode;
    }

    setDevMode(nextValue);
    const conversationId = ensureConversation();
    addMessage({
      conversationId,
      role: "user",
      content: command,
    });
    addMessage({
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
  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/dev")) {
      handleDevCommand(trimmed);
      setInput("");
      return;
    }
    if (!selectedModel && !devMode) {
      return;
    }
    const conversationId = ensureConversation();
    addMessage({ conversationId, role: "user", content: trimmed });
    sendMessage(trimmed);
    setInput("");
  };

  /**
   * Regenerate a specific assistant response.
   * @param messageIndex - Index of the assistant message to regenerate.
   */
  const handleRegenerate = (messageIndex: number) => {
    if (isStreaming) return;
    const previousUserMessage = [...messages]
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === "user");
    const targetMessage = messages[messageIndex];
    if (!previousUserMessage || targetMessage?.role !== "assistant") return;
    // TODO: implement message deletion for regeneration
    sendMessage(previousUserMessage.content);
  };

  const handleNewChat = () => {
    stopStreaming();
    createConversation();
  };

  const handleSelectConversation = (id: string) => {
    stopStreaming();
    setActiveConversationId(id);
  };

  return (
    <SidebarProvider>
      <Sidebar
        onOpenSettings={handleOpenSettings}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        conversations={conversations}
        activeConversationId={activeConversationId}
      />

      <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-background font-sans">
        <Header
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          availableModels={availableModels}
          onModelChange={setSelectedModel}
          isLoading={isLoading}
          ollamaError={ollamaError}
        />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {hasMessages ? (
            <ChatArea
              messages={messages}
              bottomRef={bottomRef}
              onRegenerate={handleRegenerate}
            />
          ) : (
            <EmptyState />
          )}

          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            onStop={stopStreaming}
            isStreaming={isStreaming}
            selectedModel={devMode ? "Dev Mode" : selectedModel}
            allowEmptyModel={devMode}
          />
        </main>
      </SidebarInset>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleCloseSettings} />
    </SidebarProvider>
  );
}

export default App;