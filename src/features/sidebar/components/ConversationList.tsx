import { MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { ConversationItem } from "@/features/chat/components/ConversationItem";
import {
  SidebarGroupLabel,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  SidebarMenuRow,
  SidebarSectionHeader,
} from "@/features/sidebar/components/sidebar-utils";
import { ConversationSkeleton } from "@/features/sidebar/components/ConversationSkeleton";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { useSidebarActions } from "@/features/sidebar/hooks/useSidebarActions";
import { useChatStore } from "@/store/chatStore";
import { useNotify } from "@/hooks/useNotify";
import { ConversationGroup } from "@/features/sidebar/hooks/useConversationGroups";
import type { Conversation } from "@/types/chat";
import { getRepository } from "@/lib/repositories";

type ConversationRow =
  | { id: string; type: "group"; label: string }
  | { id: string; type: "conversation"; conversation: Conversation };

export interface ConversationListProps {
  groupedConversations: ConversationGroup[];
  conversationsLoading: boolean;
  streamingConversationId: string | null;
}

export function ConversationList({
  groupedConversations,
  conversationsLoading,
  streamingConversationId,
}: ConversationListProps) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { conv, onSelectConversation } = useSidebarActions();
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const notify = useNotify();
  const reduceMotion = useReducedMotion();

  const rows = useMemo<ConversationRow[]>(
    () =>
      groupedConversations.flatMap((group) => [
        { id: `group-${group.id}`, type: "group" as const, label: group.label },
        ...group.items.map((conversation) => ({
          id: conversation.id,
          type: "conversation" as const,
          conversation,
        })),
      ]),
    [groupedConversations],
  );

  const handleExport = async (c: Conversation) => {
    try {
      const repo = getRepository();
      const messages = await repo.getMessages(c.id, 99999, 0);
      const payload = { conversation: c, messages };
      const json = JSON.stringify(payload, null, 2);
      const fileName = `${(c.title || "untitled").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;

      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const filePath = await save({
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: fileName,
        });
        if (!filePath) return;
        await writeTextFile(filePath, json);
      } catch {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      notify.success("Conversation exported");
    } catch (err) {
      notify.error("Failed to export conversation", String(err));
    }
  };

  if (conversationsLoading) {
    return <ConversationSkeleton />;
  }

  if (groupedConversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center text-muted-foreground">
        <MessageSquare size={16} className="opacity-50" />
        <p className="text-xs leading-[1.4] opacity-75">
          No chats yet
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-0.5 px-5 group-data-[collapsible=icon]:hidden">
        <SidebarSectionHeader label="Chats" />
      </div>
      {/* Row counts here are small (tens), so the list renders in normal flow.
          Virtualizing it cost more than it saved: a ResizeObserver per row plus
          a measure/re-render pass on every commit. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [contain:layout_paint]">
        {rows.map((row) =>
          row.type === "group" ? (
            <SidebarGroupLabel key={row.id} className="px-5 font-normal">
              {row.label}
            </SidebarGroupLabel>
          ) : (
            // Padding comes from the collapsible data attribute rather than
            // React state: as state, it flipped 12px -> 4px on the first frame
            // while the panel was still animating, jerking every row sideways
            // before the width had moved.
            <div
              key={row.id}
              className={cn(
                "px-3 py-px group-data-[collapsible=icon]:px-1",
                !reduceMotion &&
                  "transition-[padding] duration-(--sidebar-transition-duration) ease-(--sidebar-transition-easing)",
              )}
            >
              <SidebarMenuButton
                asChild
                isActive={activeConversationId === row.conversation.id}
                tooltip={row.conversation.title || "Untitled"}
                onClick={() => {
                  onSelectConversation(row.conversation.id);
                  if (isMobile) setOpenMobile(false);
                }}
                className="px-2"
              >
                {/* Row embeds its own action buttons, so it can't be a
                    real <button>. */}
                <SidebarMenuRow>
                  <ConversationItem
                    conv={row.conversation}
                    activeConversationId={activeConversationId}
                    isGenerating={streamingConversationId === row.conversation.id}
                    isCollapsed={isCollapsed}
                    editingId={conv.editingId}
                    editValue={conv.editValue}
                    setEditValue={conv.setEditValue}
                    handleConfirmRename={conv.handleConfirmRename}
                    handleCancelRename={conv.handleCancelRename}
                    handleStartRename={conv.handleStartRename}
                    handleArchive={conv.handleArchive}
                    handleStartDelete={conv.handleStartDelete}
                    onExport={handleExport}
                  />
                </SidebarMenuRow>
              </SidebarMenuButton>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
