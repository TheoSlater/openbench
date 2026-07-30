import { useCallback, type MutableRefObject } from "react";
import { useThemeStore } from "@/store/themeStore";
import type { ThemeMode } from "@/store/themeStore";
import { getNextThemeMode } from "@/lib/theme";

export function useChatActionHandlers({
  stopStreamingRef,
  notify,
  renameConversation,
  deleteAllConversations,
  activeConversationId,
}: {
  stopStreamingRef: MutableRefObject<(() => void) | null>;
  notify: { success: (msg: string) => void };
  renameConversation: (id: string, newTitle: string, titleSource?: "default" | "generated" | "manual") => Promise<void>;
  deleteAllConversations: () => Promise<void>;
  activeConversationId: string | null;
}) {
  const handleDeleteAllConversations = useCallback(
    async (options?: { confirmed?: boolean }) => {
      if (
        !options?.confirmed &&
        !window.confirm("Delete all chats? This cannot be undone.")
      ) {
        return;
      }
      stopStreamingRef.current?.();
      await deleteAllConversations();
      notify.success("All chats deleted");
    },
    [deleteAllConversations, notify],
  );

  const handleRenameCurrentChat = useCallback(
    async ({ title }: { title: string }) => {
      if (!activeConversationId || !title.trim()) return;
      await renameConversation(activeConversationId, title.trim(), "manual");
      notify.success("Conversation renamed");
    },
    [activeConversationId, notify, renameConversation],
  );

  const handleSetTheme = useCallback(
    ({ theme }: { theme?: ThemeMode }) => {
      const themeStore = useThemeStore.getState();
      const nextTheme = theme ?? getNextThemeMode(themeStore.mode);
      themeStore.setMode(nextTheme);
      notify.success(
        `Theme: ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)}`,
      );
    },
    [notify],
  );


  return {
    handleDeleteAllConversations,
    handleRenameCurrentChat,
    handleSetTheme,
  };
}
