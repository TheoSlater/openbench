import { useState } from "react";
import { useModels, useChatStream } from "@/hooks";
import { Header, ChatArea, EmptyState, ChatInput } from "@/components/Chat";
import "./App.css";

function App() {
  const { models, selectedModel, setSelectedModel, isLoading } = useModels();
  const [input, setInput] = useState("");

  const { messages, isStreaming, sendMessage, bottomRef, hasMessages } =
    useChatStream(selectedModel);

  const handleSend = () => {
    sendMessage(input);
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
          <ChatArea messages={messages} bottomRef={bottomRef} />
        ) : (
          <EmptyState />
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          isStreaming={isStreaming}
          selectedModel={selectedModel}
        />
      </main>
    </div>
  );
}

export default App;