import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Attachment } from "@/types/chat";
import { useChatStore } from "@/store/chatStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import { useAcpActivityStore } from "./activity-store";
import { getCurrentProviderAccountId } from "@/features/providers";
import type { AcpActivityState } from "./activity-reducer";

const EMPTY_HISTORY: AcpActivityState[] = [];

export function useAcpChat() {
  const runtime = useRuntimeStore((state) => state.selected);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const addMessage = useChatStore((state) => state.actions.addMessage);
  const settings = useSettingsStore(
    useShallow((state) => ({
      codex: state.codex,
      codexWorkspace: state.codexWorkspace,
      claude: state.claude,
      claudeWorkspace: state.claudeWorkspace,
    })),
  );
  const activity = useAcpActivityStore(
    (state) => activeConversationId ? state.activities[activeConversationId] : undefined,
  );
  const history = useAcpActivityStore(
    (state) => (activeConversationId ? state.histories[activeConversationId] : undefined) ?? EMPTY_HISTORY,
  );
  const actions = useAcpActivityStore((state) => state.actions);
  const isAgent = runtime?.kind === "coding-agent";

  const sendMessage = useCallback(async (
    content: string,
    attachments?: Attachment[],
    conversationIdOverride?: string,
  ) => {
    const conversationId = conversationIdOverride ?? activeConversationId;
    if (!isAgent || !conversationId || !content.trim()) return;
    await addMessage({
      conversationId,
      role: "user",
      content: content.trim(),
      attachments,
    });
    const current = useAcpActivityStore.getState().activities[conversationId];
    if (!current?.descriptor || !current.sessionId || current.status === "failed") {
      const codex = runtime.agent_kind === "codex";
      await actions.start({
        conversation_id: conversationId,
        account_id: getCurrentProviderAccountId(),
        agent_kind: runtime.agent_kind,
        workspace_id: runtime.workspace_id,
        codex_settings: codex ? settings.codex : null,
        claude_settings: codex ? null : settings.claude,
      });
    }
    await actions.prompt(conversationId, content.trim());
  }, [actions, activeConversationId, addMessage, isAgent, runtime, settings]);

  const stopStreaming = useCallback(async () => {
    if (activeConversationId) await actions.cancel(activeConversationId);
  }, [actions, activeConversationId]);

  return {
    isAgent,
    activity,
    history,
    isStreaming: activity?.status === "running",
    sendMessage,
    stopStreaming,
  };
}
