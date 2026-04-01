import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Message, Role } from "./components/Chat/Message";
import { Send, Settings, TerminalSquare } from "lucide-react";
import "./App.css";

interface StreamPayload {
  content: string;
  done: boolean;
}

interface ChatMessage {
  role: Role;
  content: string;
}

function App() {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch local models on startup
    invoke<string[]>("get_local_models")
      .then((models) => {
        setModels(models);
        if (models.length > 0) setSelectedModel(models[0]);
      })
      .catch((e) => console.error("Failed to load models:", e));
  }, []);

  useEffect(() => {
    // Listen for streaming chunks
    const unlistenPromise = listen<StreamPayload>("chat-chunk", (event) => {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        
        if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
           // Append to existing assistant message
           newMessages[lastIndex] = {
             ...newMessages[lastIndex],
             content: newMessages[lastIndex].content + event.payload.content
           };
        } else {
           // Create new assistant message
           newMessages.push({ role: 'assistant', content: event.payload.content });
        }
        return newMessages;
      });

      if (event.payload.done) {
        setIsStreaming(false);
      }
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  useEffect(() => {
    // Auto scroll to bottom
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || isStreaming) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setIsStreaming(true);

    try {
      await invoke("chat_stream", {
        model: selectedModel,
        message: userMsg,
      });
    } catch (e) {
      console.error("Chat error:", e);
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-900 text-neutral-200 overflow-hidden font-sans">
      {/* Top Bar */}
      <header className="h-14 border-b border-neutral-800 bg-neutral-950/50 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <TerminalSquare size={20} className="text-neutral-400" />
          <h1 className="font-semibold text-sm tracking-wide text-neutral-300">OpenBench</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <select 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-neutral-800 border-none rounded px-3 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 outline-none w-48 truncate"
          >
            {models.length === 0 ? (
              <option value="">No models found...</option>
            ) : (
              models.map(m => <option key={m} value={m}>{m}</option>)
            )}
          </select>
          <button className="text-neutral-400 hover:text-neutral-200 transition-colors">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center flex-col gap-4 text-neutral-500">
            <TerminalSquare size={48} className="opacity-20" />
            <p className="text-sm">Select a model and start typing to begin.</p>
          </div>
        ) : (
          <div className="pb-8">
            {messages.map((msg, i) => (
              <Message key={i} role={msg.role} content={msg.content} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-neutral-900 border-t border-neutral-800/50 shrink-0">
        <div className="max-w-3xl mx-auto relative flex items-end gap-2 bg-neutral-800 rounded-lg border border-neutral-700 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "Generating..." : "Message " + (selectedModel || "model...")}
            disabled={isStreaming}
            rows={1}
            className="w-full bg-transparent border-none focus:ring-0 resize-none py-4 px-4 pr-12 max-h-32 text-sm disabled:opacity-50"
            style={{ minHeight: '56px' }}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="absolute right-3 bottom-3 p-1.5 rounded bg-blue-600 text-white disabled:opacity-50 disabled:bg-neutral-600 hover:bg-blue-500 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-center text-xs text-neutral-500 mt-3 flex items-center justify-center gap-1">
          OpenBench uses local Ollama directly. Your data stays on your machine.
        </p>
      </footer>
    </div>
  );
}

export default App;
