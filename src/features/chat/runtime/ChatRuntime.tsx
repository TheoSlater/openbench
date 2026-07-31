import { memo, useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message } from "@/types/chat";
import type { PolyUIMessage } from "@/lib/ai/messages";
import { TauriChatTransport } from "@/lib/ai/transport";

export type ChatJob = {
  requestId: string;
  messageId: string;
  conversationId: string;
  connectionId: string;
  model: string;
  provider: Message["provider"];
  messages: PolyUIMessage[];
  instructions?: string;
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  webSearchProvider?: "local" | "exa" | "ollama" | "tavily";
  token: () => string | null;
  cancelled?: boolean;
};

type Props = {
  jobs: ChatJob[];
  onUpdate: (job: ChatJob, message: PolyUIMessage) => void;
  onFinish: (
    job: ChatJob,
    message: PolyUIMessage,
    state: { aborted: boolean; failed: boolean },
  ) => void;
  onError: (job: ChatJob, error: Error) => void;
};

const ModelChatSession = memo(function ModelChatSession({
  job,
  onUpdate,
  onFinish,
  onError,
}: Omit<Props, "jobs"> & { job: ChatJob }) {
  const last = job.messages[job.messages.length - 1];
  const initialMessages = useMemo(() => job.messages.slice(0, -1), [job.messages]);
  const transport = useMemo(() => new TauriChatTransport<PolyUIMessage>({
    requestId: job.requestId,
    responseMessageId: job.messageId,
    conversationId: job.conversationId,
    connectionId: job.connectionId,
    modelId: job.model,
    instructions: job.instructions,
    reasoning: job.reasoning,
    webSearchProvider: job.webSearchProvider,
    token: job.token,
  }), [job]);
  const started = useRef(false);
  const {
    messages,
    sendMessage,
    stop,
  } = useChat<PolyUIMessage>({
    id: job.requestId,
    messages: initialMessages,
    transport,
    throttle: 50,
    onFinish: ({ message, isAbort, isError }) => {
      onFinish(job, message, { aborted: isAbort, failed: isError });
    },
    onError: (error) => onError(job, error),
  });

  useEffect(() => {
    if (started.current || !last) return;
    started.current = true;
    void sendMessage(last);
  }, [last, sendMessage]);

  useEffect(() => {
    const assistant = messages[messages.length - 1];
    if (assistant?.role === "assistant") onUpdate(job, assistant);
  }, [job, messages, onUpdate]);

  useEffect(() => {
    if (job.cancelled) void stop();
  }, [job.cancelled, stop]);

  return null;
});

export const ChatRuntime = memo(function ChatRuntime({
  jobs,
  onUpdate,
  onFinish,
  onError,
}: Props) {
  return jobs.map((job) => (
    <ModelChatSession
      key={job.requestId}
      job={job}
      onUpdate={onUpdate}
      onFinish={onFinish}
      onError={onError}
    />
  ));
});
