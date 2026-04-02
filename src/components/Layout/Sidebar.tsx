"use client";

// Design: Compact, utilitarian sidebar with icon-first controls and muted surfaces.

import * as React from "react";
import { MoreHorizontal, SquarePen, Pencil, Trash } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
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
  onDeleteConversation,
  onRenameConversation,
  conversations,
  activeConversationId,
}: SidebarProps) {
  const { isCollapsed, setOpenMobile, isMobile } = useSidebar();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const editInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  };

  const handleSaveRename = () => {
    if (editingId && editTitle.trim()) {
      onRenameConversation(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = () => {
    setEditingId(null);
  };

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
          <SidebarMenuButton
            aria-label="New chat"
            onClick={() => {
              onNewChat();
              if (isMobile) setOpenMobile(false);
            }}
          >
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
                        {editingId === conversation.id ? (
                          <div className="flex w-full items-center gap-2 px-2 py-1.5">
                            <input
                              ref={editInputRef}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onBlur={handleSaveRename}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveRename();
                                if (e.key === "Escape") handleCancelRename();
                              }}
                              className="h-7 w-full rounded-sm border border-sidebar-accent bg-background px-2 text-sm focus:border-sidebar-accent focus:outline-hidden"
                            />
                          </div>
                        ) : (
                          <>
                            <SidebarMenuButton
                              isActive={
                                conversation.id === activeConversationId
                              }
                              className="justify-between gap-3 pr-8"
                              onClick={() => {
                                onSelectConversation(conversation.id);
                                if (isMobile) setOpenMobile(false);
                              }}
                            >
                              <span className="flex-1 truncate text-left">
                                {conversation.title}
                              </span>
                              <span className="text-[11px] text-muted-foreground/70 group-hover:hidden">
                                {formatConversationTime(conversation.updatedAt)}
                              </span>
                            </SidebarMenuButton>

                            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="flex size-7 items-center justify-center rounded-md hover:bg-sidebar-accent text-muted-foreground transition-colors"
                                  aria-label="Conversation options"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartRename(conversation);
                                    }}
                                  >
                                    <Pencil className="size-4" />
                                    <span>Rename</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteConversation(conversation.id);
                                    }}
                                  >
                                    <Trash className="size-4" />
                                    <span>Delete</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </>
                        )}
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
