"use client";

// Design: Compact, utilitarian sidebar with icon-first controls and muted surfaces.

import * as React from "react";
import { MoreHorizontal, SquarePen, Pencil, Trash, Settings } from "lucide-react";
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
  SidebarTrigger,
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
    <SidebarRoot collapsible="icon" className="border-r border-white/5 bg-[#0d0d0d]">
      <SidebarHeader className="h-14 px-3 flex flex-row items-center justify-between">
        <div className={cn("flex items-center gap-2", isCollapsed && "sr-only")}>
          <div className="size-6 rounded-md bg-[#10a37f] flex items-center justify-center">
            <div className="size-3.5 rounded-full border-[1.5px] border-white/90" />
          </div>
          <span className="font-semibold text-[15px] text-white/90 tracking-tight">OpenBench</span>
        </div>
        {!isCollapsed && (
          <button 
            onClick={onNewChat}
            className="flex size-8 items-center justify-center rounded-lg hover:bg-white/5 text-white/60 transition-colors"
            aria-label="New chat"
          >
            <SquarePen className="size-[18px]" />
          </button>
        )}
        {isCollapsed && <SidebarTrigger className="mx-auto" />}
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 space-y-6 overflow-x-hidden">
        {/* Conversation History */}
        {!isCollapsed && groupEntries.length > 0 && (
          <div className="space-y-4">
            {groupEntries.map(([label, items]) => (
              <SidebarGroup key={label} className="p-0">
                <SidebarGroupLabel className="px-2 text-[11px] font-bold text-white/30 uppercase tracking-wider">{label}</SidebarGroupLabel>
                <SidebarMenu className="mt-1">
                  {items.map((conversation) => (
                    <div key={conversation.id} className="group relative">
                      {editingId === conversation.id ? (
                        <div className="px-2 py-1">
                          <input
                            ref={editInputRef}
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={handleSaveRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename();
                              if (e.key === "Escape") handleCancelRename();
                            }}
                            className="h-8 w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-2 text-[13px] text-white outline-hidden focus:border-[#10a37f]/50"
                          />
                        </div>
                      ) : (
                        <>
                          <SidebarMenuButton
                            isActive={conversation.id === activeConversationId}
                            className={cn(
                              "h-9 w-full justify-start px-2 text-[14px] font-medium transition-all duration-200",
                              conversation.id === activeConversationId 
                                ? "bg-white/10 text-white" 
                                : "text-white/70 hover:bg-white/5 hover:text-white"
                            )}
                            onClick={() => {
                              onSelectConversation(conversation.id);
                              if (isMobile) setOpenMobile(false);
                            }}
                          >
                            <span className="flex-1 truncate">{conversation.title}</span>
                          </SidebarMenuButton>
                          
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <button className="size-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40 bg-[#1a1a1a] border-white/10 text-white/90">
                                <DropdownMenuItem onClick={() => handleStartRename(conversation)} className="hover:bg-white/5 focus:bg-white/5 cursor-pointer">
                                  <Pencil className="mr-2 size-4 opacity-60" />
                                  <span>Rename</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  variant="destructive" 
                                  onClick={() => onDeleteConversation(conversation.id)}
                                  className="text-red-400 hover:bg-red-400/10 focus:bg-red-400/10 cursor-pointer"
                                >
                                  <Trash className="mr-2 size-4" />
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
            ))}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <button
          onClick={onOpenSettings}
          className={cn(
            "flex size-10 items-center justify-center rounded-xl text-white/40 transition-all hover:bg-white/5 hover:text-white",
            isCollapsed && "mx-auto"
          )}
          title="Settings"
        >
          <Settings className="size-5" />
        </button>
      </SidebarFooter>
    </SidebarRoot>
  );
}
