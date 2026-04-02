import { useState } from "react";
import { useModels, useChatStream } from "@/hooks";
import {
  Header,
  ChatArea,
  EmptyState,
  ChatInput,
} from "@/components/Chat";
import { modelSupportsReasoning } from "@/lib/model-utils";
import "./App.css";

function App() {
  const { models, selectedModel, setSelectedModel, isLoading } = useModels();
  const [input, setInput] = useState("");
  const [devMode, setDevMode] = useState(false);

  const supportsReasoning = devMode || modelSupportsReasoning(selectedModel);
  const {
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
    appendMessage,
    bottomRef,
    hasMessages,
  } = useChatStream(selectedModel, supportsReasoning, devMode);

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans">
      <Header
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        isLoading={isLoading}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {hasMessages ? (
          <ChatArea
            messages={messages}
            bottomRef={bottomRef}
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
  );
}

export default App;
