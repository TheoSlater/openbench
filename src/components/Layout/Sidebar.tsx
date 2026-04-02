"use client";

// Design: Compact, utilitarian sidebar with icon-first controls and muted surfaces.

import { MoreHorizontal, SquarePen } from "lucide-react";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarSeparator,
  SidebarTrigger,
  SidebarIconButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/store/chatStore";

type SidebarProps = {
  onOpenSettings: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
};

const getConversationGroupLabel = (updatedAt: string) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const updated = new Date(updatedAt);

  if (updated >= todayStart) return "Today";
  if (updated >= yesterdayStart) return "Yesterday";
  if (updated >= weekStart) return "This Week";
  if (updated >= lastWeekStart) return "Last Week";
  if (updated >= monthStart) return "This Month";
  return "Earlier";
};

const formatConversationTime = (updatedAt: string) => {
  const updated = new Date(updatedAt);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (updated >= todayStart) {
    return updated.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return updated.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

/**
 * Persistent left sidebar with primary actions.
 * @param onOpenSettings - Handler to open the settings modal.
 */
export function Sidebar({
  onOpenSettings,
  onNewChat,
  onSelectConversation,
  conversations,
  activeConversationId,
}: SidebarProps) {
  const { isCollapsed } = useSidebar();
  const grouped = conversations.reduce<Record<string, Conversation[]>>(
    (groups, conversation) => {
      const label = getConversationGroupLabel(conversation.updatedAt);
      groups[label] = groups[label]
        ? [...groups[label], conversation]
        : [conversation];
      return groups;
    },
    {},
  );
  const groupOrder = [
    "Today",
    "Yesterday",
    "This Week",
    "Last Week",
    "This Month",
    "Earlier",
  ];
  const groupEntries = Object.entries(grouped).sort(
    ([a], [b]) => groupOrder.indexOf(a) - groupOrder.indexOf(b),
  );

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader
        className={cn(
          "h-16 px-2",
          isCollapsed ? "justify-center" : "justify-between",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-2",
            isCollapsed && "sr-only",
          )}
        >
          <div className="text-sm font-semibold text-foreground/90">
            OpenBench
          </div>
        </div>
        <SidebarTrigger className={cn(isCollapsed && "mx-auto")} />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="pt-3">
        <SidebarMenu>
          <SidebarMenuButton aria-label="New chat" onClick={onNewChat}>
            <SquarePen className="size-4" />
            <span className={cn("truncate", isCollapsed && "sr-only")}>
              New chat
            </span>
          </SidebarMenuButton>
        </SidebarMenu>

        {!isCollapsed ? (
          <div className="mt-4 space-y-4">
            {groupEntries.length > 0 ? (
              groupEntries.map(([label, items]) => (
                <SidebarGroup key={label}>
                  <SidebarGroupLabel>{label}</SidebarGroupLabel>
                  <SidebarMenu>
                    {items.map((conversation) => (
                      <div key={conversation.id} className="group relative">
                        <SidebarMenuButton
                          isActive={conversation.id === activeConversationId}
                          className="justify-between gap-3"
                          onClick={() => onSelectConversation(conversation.id)}
                        >
                          <span className="flex-1 truncate text-left">
                            {conversation.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground/70">
                            {formatConversationTime(conversation.updatedAt)}
                          </span>
                        </SidebarMenuButton>
                      </div>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              ))
            ) : (
              <div className="px-2 text-xs text-muted-foreground/70">
                No conversations yet.
              </div>
            )}
          </div>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="justify-end">
        <SidebarIconButton
          aria-label="Options"
          onClick={onOpenSettings}
          className={cn(isCollapsed ? "mx-auto" : "mr-2")}
        >
          <MoreHorizontal className="size-4" />
        </SidebarIconButton>
      </SidebarFooter>
    </SidebarRoot>
  );
}
