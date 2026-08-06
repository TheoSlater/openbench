import * as React from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Edit2,
  Download,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConversationItem } from "@/features/chat/components/ConversationItem";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import {
  SidebarMenuRow,
  sidebarIconButtonClassName,
} from "@/features/sidebar/components/sidebar-utils";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { useSidebarActions } from "@/features/sidebar/hooks/useSidebarActions";
import { useFolderStore } from "@/store/folderStore";
import { useChatStore } from "@/store/chatStore";
import { Conversation, Folder as FolderType } from "@/types/chat";

export interface FolderTreeProps {
  folder: FolderType;
  depth?: number;
  folderConversations: Conversation[];
  streamingConversationId: string | null;
}

export function FolderTree({
  folder,
  depth = 0,
  folderConversations,
  streamingConversationId,
}: FolderTreeProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { folder: folderActions, conv } = useSidebarActions();
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveFolderId = useFolderStore((s) => s.actions.setActiveFolderId);
  const setActiveConversationId = useChatStore(
    (s) => s.actions.setActiveConversationId,
  );

  const chats = folderConversations.filter(
    (conversation) => conversation.folderId === folder.id,
  );
  const children = folders.filter(
    (candidate) => candidate.parentId === folder.id,
  );
  const hasChildren = chats.length > 0 || children.length > 0;
  const containsActiveFolder = (folderId: string): boolean =>
    activeFolderId === folderId ||
    folders.some(
      (candidate) =>
        candidate.parentId === folderId &&
        containsActiveFolder(candidate.id),
    );
  const isOpen =
    containsActiveFolder(folder.id) ||
    chats.some((conversation) => conversation.id === activeConversationId);
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <React.Fragment key={folder.id}>
      <SidebarMenuButton
        render={<SidebarMenuRow />}
        isActive={activeFolderId === folder.id && !activeConversationId}
        tooltip={folder.name}
        onClick={() => {
          setActiveFolderId(folder.id);
          setActiveConversationId(null);
          if (isMobile) setOpenMobile(false);
        }}
        className="gap-1.5 pr-1 hover:[&_.folder-actions]:opacity-100 focus-within:[&_.folder-actions]:opacity-100"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {/* Row embeds its own action buttons, so it can't be a real <button>. */}
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 transition-transform duration-[var(--dur-fast)]",
            hasChildren ? "opacity-50" : "opacity-0",
            isOpen && "rotate-90",
          )}
        />
        <FolderIcon size={16} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">
          {folder.name}
        </span>
        <div className="folder-actions ml-auto flex opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-soft)]">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${folder.name}`}
                onClick={(e) => e.stopPropagation()}
                className={sidebarIconButtonClassName}
              />}
            >
                <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[170px]"
            >
              <DropdownMenuItem
                onClick={() => folderActions.openCreateInFolder(folder.id)}
              >
                <FolderPlus size={14} /> Create Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => folderActions.onOpenEdit(folder)}
              >
                <Edit2 size={14} /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => folderActions.onExport(folder)}
              >
                <Download size={14} /> Export
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => folderActions.onDelete(folder)}
              >
                <Trash2 size={14} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarMenuButton>
      {isOpen && (
        <div className="ml-4 border-l border-border/60 pl-1">
          {children.map((child) => (
            <FolderTree
              key={child.id}
              folder={child}
              depth={depth + 1}
              folderConversations={folderConversations}
              streamingConversationId={streamingConversationId}
            />
          ))}
          {chats.map((chat) => (
            <SidebarMenuButton
              key={chat.id}
              render={<SidebarMenuRow />}
              isActive={activeConversationId === chat.id}
              tooltip={chat.title || "Untitled"}
              onClick={() => {
                setActiveFolderId(folder.id);
                setActiveConversationId(chat.id);
                if (isMobile) setOpenMobile(false);
              }}
              className="pr-1"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <ConversationItem
                conv={chat}
                activeConversationId={activeConversationId}
                isGenerating={streamingConversationId === chat.id}
                variant="folderTree"
                editingId={conv.editingId}
                editValue={conv.editValue}
                setEditValue={conv.setEditValue}
                handleConfirmRename={conv.handleConfirmRename}
                handleCancelRename={conv.handleCancelRename}
                handleStartRename={conv.handleStartRename}
                handleArchive={conv.handleArchive}
                handleStartDelete={conv.handleStartDelete}
              />
            </SidebarMenuButton>
          ))}
        </div>
      )}
    </React.Fragment>
  );
}
