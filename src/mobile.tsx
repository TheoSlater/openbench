import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Menu, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationProvider } from "@/components/ui/Toast/NotificationProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatArea } from "@/features/chat/components/ChatArea";
import { MobileChatInput } from "@/features/chat/components/MobileChatInput";
import { useChatStore } from "@/store/chatStore";
import type { Conversation, Message } from "@/types/chat";
import type { ModelProvider } from "@/store/modelStore";
import "./App.css";

type ModelChoice = {
  name: string;
  providerType: ModelProvider;
  providerConfigId: number;
};

type RemoteChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Message["attachments"];
};

type ApiResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error?: string };

function tokenFromUrl() {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<ApiResult<T>> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}token=${encodeURIComponent(token)}`, init);
  return response.json() as Promise<ApiResult<T>>;
}

function newConversation(isTemporary: boolean): Conversation {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    isArchived: false,
    isTemporary,
    titleSource: "default",
  };
}

function MobileApp() {
  const token = useMemo(tokenFromUrl, []);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [status, setStatus] = useState("Connecting...");
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const messages = useChatStore((state) => state.messages);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const selectedChoice = models.find((choice) => modelKey(choice) === selectedModel) ?? models[0];

  useEffect(() => {
    if (!token) {
      setStatus("Missing pairing token.");
      return;
    }

    let cancelled = false;
    async function load() {
      const statusResult = await api<Record<string, never>>("/api/status", token);
      if (!statusResult.ok) throw new Error(statusResult.error ?? "Pairing token rejected.");

      const [modelResult, conversationResult] = await Promise.all([
        api<{ models: ModelChoice[] }>("/api/models", token),
        api<{ conversations: Conversation[] }>("/api/conversations", token),
      ]);
      if (!modelResult.ok) throw new Error(modelResult.error ?? "Could not load models.");
      if (!conversationResult.ok) throw new Error(conversationResult.error ?? "Could not load chats.");
      if (cancelled) return;

      setModels(modelResult.models);
      setSelectedModel(modelResult.models[0] ? modelKey(modelResult.models[0]) : "");
      useChatStore.setState({
        conversations: conversationResult.conversations,
        activeConversationId: conversationResult.conversations[0]?.id ?? null,
      });
      if (conversationResult.conversations[0]) {
        await loadMessages(conversationResult.conversations[0].id);
      }
      setStatus(modelResult.models.length ? "Connected to desktop." : "Connected. No provider models found.");
    }

    load().catch((error) => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function loadMessages(conversationId: string) {
    const result = await api<{ messages: Message[] }>(
      `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
      token,
    );
    if (!result.ok) throw new Error(result.error ?? "Could not load messages.");
    useChatStore.setState({
      activeConversationId: conversationId,
      messages: result.messages,
      hasMoreMessages: false,
    });
  }

  async function createChat(nextTemporary = temporary) {
    if (activeConversation && messages.length === 0) return;
    const conversation = newConversation(nextTemporary);
    useChatStore.setState((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      messages: [],
    }));
  }

  async function submit(content: string) {
    if (!content || !selectedChoice || busy) return;

    let conversation = activeConversation;
    if (!conversation) {
      conversation = newConversation(temporary);
      useChatStore.setState((state) => ({
        conversations: [conversation!, ...state.conversations],
        activeConversationId: conversation!.id,
        messages: [],
      }));
    }

    const userMessage: Message = {
      id: uuid(),
      conversationId: conversation.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      model: selectedChoice.name,
      provider: selectedChoice.providerType,
    };
    setBusy(true);
    setStatus("Thinking...");
    useChatStore.setState((state) => ({
      messages: [...state.messages, userMessage],
      conversations: state.conversations.map((item) =>
        item.id === conversation!.id
          ? { ...item, title: item.title === "New Chat" ? content.slice(0, 48) : item.title, updatedAt: userMessage.createdAt }
          : item,
      ),
    }));

    if (!conversation.isTemporary) {
      if (messages.length === 0) {
        await api<Record<string, never>>("/api/conversations", token, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: conversation.id,
            title: conversation.title,
          }),
        });
      }
      await api<Record<string, never>>("/api/messages", token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: userMessage.id,
          conversation_id: conversation.id,
          role: userMessage.role,
          content: userMessage.content,
          model: selectedChoice.name,
          provider: selectedChoice.providerType,
          is_temporary: false,
        }),
      });
    }

    try {
      const chatMessages: RemoteChatMessage[] = [...messages, userMessage].map((message) => ({
        role: message.role,
        content: message.content,
        attachments: message.attachments,
      }));
      const assistant: Message = {
        id: uuid(),
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        model: selectedChoice.name,
        provider: selectedChoice.providerType,
        isStreaming: true,
        status: "streaming",
      };
      useChatStore.setState((state) => ({ messages: [...state.messages, assistant] }));
      await streamChat("/api/chat-stream", token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: selectedChoice.name,
          messages: chatMessages,
          conversation_id: conversation.id,
          is_temporary: Boolean(conversation.isTemporary),
          provider_type: selectedChoice.providerType,
          provider_config_id: selectedChoice.providerConfigId,
        }),
      }, {
        onChunk: (chunk) => {
          assistant.content += chunk;
          useChatStore.setState((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistant.id ? { ...assistant } : message,
            ),
          }));
        },
        onDone: (id) => {
          const previousId = assistant.id;
          assistant.id = id || assistant.id;
          assistant.isStreaming = false;
          assistant.status = "complete";
          useChatStore.setState((state) => ({
            messages: state.messages.map((message) =>
              message.id === previousId ? { ...assistant } : message,
            ),
          }));
        },
      });
      setStatus("Connected to desktop.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-dvh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-muted/30 sm:flex sm:flex-col">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewChat={() => void createChat()}
          onSelect={(id) => void loadMessages(id)}
        />
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 flex sm:hidden">
          <button
            type="button"
            aria-label="Close chats"
            className="absolute inset-0 bg-background/70"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-[82vw] max-w-80 flex-col border-r border-border/60 bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 p-3">
              <div className="text-sm font-semibold">Chats</div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => setSidebarOpen(false)}>
                <X />
              </Button>
            </div>
            <ConversationSidebar
              conversations={conversations}
              activeConversationId={activeConversationId}
              onNewChat={() => {
                setSidebarOpen(false);
                void createChat();
              }}
              onSelect={(id) => {
                setSidebarOpen(false);
                void loadMessages(id);
              }}
            />
          </aside>
        </div>
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setSidebarOpen(true)} className="sm:hidden">
            <Menu />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => void createChat()}>
            <Plus />
          </Button>
          <select
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-xl border border-border/60 bg-background px-2 text-sm outline-none"
          >
            {models.map((choice) => (
              <option key={modelKey(choice)} value={modelKey(choice)}>
                {choice.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={temporary}
              onChange={(event) => setTemporary(event.target.checked)}
            />
            Temp
          </label>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => useChatStore.setState({ messages: [] })}>
            <Trash2 />
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <ChatArea messages={messages} bottomRef={bottomRef} isTemporary={activeConversation?.isTemporary} />
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-border/60 bg-card p-3">
          <MobileChatInput
            onSubmit={submit}
            isStreaming={busy}
            disabled={!selectedChoice}
            status={status}
            isTemporary={activeConversation?.isTemporary}
          />
        </div>
      </section>
    </main>
  );
}

async function streamChat(
  path: string,
  token: string,
  init: RequestInit,
  handlers: { onChunk: (chunk: string) => void; onDone: (id?: string) => void },
) {
  const response = await fetch(`${path}?token=${encodeURIComponent(token)}`, init);
  if (!response.body) throw new Error("Streaming is not available.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const eventText of events) {
      const event = parseSse(eventText);
      if (event.event === "chunk") {
        handlers.onChunk(String(event.data.content ?? ""));
      } else if (event.event === "done") {
        handlers.onDone(typeof event.data.id === "string" ? event.data.id : undefined);
      } else if (event.event === "error") {
        throw new Error(String(event.data.error ?? "Chat failed."));
      }
    }
  }
}

function parseSse(text: string): { event: string; data: Record<string, unknown> } {
  const event = text.match(/^event: (.+)$/m)?.[1] ?? "message";
  const rawData = text.match(/^data: (.+)$/m)?.[1] ?? "{}";
  return { event, data: JSON.parse(rawData) as Record<string, unknown> };
}

function modelKey(choice: ModelChoice) {
  return `${choice.providerType}:${choice.providerConfigId}:${choice.name}`;
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function ConversationSidebar({
  conversations,
  activeConversationId,
  onNewChat,
  onSelect,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 p-3">
        <div className="text-sm font-semibold">PolyUI</div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onNewChat} aria-label="New chat">
          <Plus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.length ? (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={`mb-1 w-full truncate rounded-xl px-3 py-2 text-left text-sm ${
                conversation.id === activeConversationId ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {conversation.title || "New Chat"}
            </button>
          ))
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">No chats yet.</div>
        )}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <NotificationProvider>
        <MobileApp />
      </NotificationProvider>
    </TooltipProvider>
  </React.StrictMode>,
);
