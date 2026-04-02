import { useEffect, useState } from "react";
import { useChatStream, useModelPicker, useSystemPrompts } from "@/hooks";
import {
  Header,
  ChatArea,
  EmptyState,
  ChatInput,
} from "@/components/Chat";
import { modelSupportsReasoning } from "@/lib/model-utils";
import { useModelStore } from "@/store/modelStore";
import { Sidebar } from "@/components/Layout/Sidebar";
import { SettingsModal } from "@/components/Settings/SettingsModal";
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
    appendMessage,
    removeMessageAt,
    bottomRef,
    hasMessages,
  } = useChatStream(
    selectedModel,
    supportsReasoning,
    devMode,
    activeSystemPrompt?.content ?? "",
  );

  /**
   * Handle /dev commands for mock responses.
   * @param command - The raw command string.
   */
  const handleDevCommand = (command: string) => {
    const [, arg] = command.trim().split(/\s+/);
    let nextValue = devMode;

    if (arg === "on") {
      nextValue = true;
    } else if (arg === "off") {
      nextValue = false;
    } else if (arg === "help") {
      appendMessage({ role: "user", content: command });
      appendMessage({
        role: "assistant",
        content: "Usage: /dev [on|off] — toggles mock responses.",
      });
      return;
    } else {
      nextValue = !devMode;
    }

    setDevMode(nextValue);
    appendMessage({ role: "user", content: command });
    appendMessage({
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
    removeMessageAt(messageIndex);
    sendMessage(previousUserMessage.content, { skipUserAppend: true });
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-sans">
      <Sidebar onOpenSettings={handleOpenSettings} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          availableModels={availableModels}
          onModelChange={setSelectedModel}
          isLoading={isLoading}
          ollamaError={ollamaError}
        />

        <main className="flex flex-1 flex-col overflow-hidden">
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
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleCloseSettings} />
    </div>
  );
}

export default App;
