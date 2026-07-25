import * as React from "react";
import { Box } from "@/components/ui/Box";
import { ButtonBase } from "@/components/ui/button-base";
import { IconButton } from "@/components/ui/icon-button";
import { Typography } from "@/components/ui/Typography";


import {
  Check,
  Circle,
  X,
  MoreHorizontal,
  Edit2,
  Archive,
  Trash2,
  Download,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activateRowOnKeyDown } from "@/features/sidebar/components/sidebar-utils";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { Conversation } from "@/store/chatStore";
import { cn } from "@/lib/utils";

interface ConversationItemProps {
  conv: Conversation;
  activeConversationId: string | null;
  isGenerating: boolean;
  onClick?: () => void;
  selected?: boolean;
  onToggleSelect?: (e: React.MouseEvent, id: string) => void;
  editingId?: string | null;
  editValue?: string;
  setEditValue?: (v: string) => void;
  handleConfirmRename?: (e: React.MouseEvent, id: string) => void;
  handleCancelRename?: (e: React.MouseEvent) => void;
  handleStartRename?: (e: React.MouseEvent, conv: Conversation) => void;
  handleArchive?: (id: string) => void;
  handleStartDelete?: (conv: Conversation) => void;
  onExport?: (conv: Conversation) => void;
  isCollapsed?: boolean;
  variant?: "sidebar" | "folder" | "folderTree";
}

export const ConversationItem = React.memo(function ConversationItem({
  conv,
  activeConversationId,
  isGenerating,
  onClick,
  selected = false,
  onToggleSelect,
  editingId,
  editValue = "",
  setEditValue,
  handleConfirmRename,
  handleCancelRename,
  handleStartRename,
  handleArchive,
  handleStartDelete,
  onExport,
  isCollapsed: _isCollapsed = false,
  variant = "sidebar",
}: ConversationItemProps) {
  const isFolder = variant === "folder";
  const isActive = activeConversationId === conv.id;

  const content = editingId === conv.id ? (
    <Box className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue?.(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirmRename?.(e as any, conv.id);
          if (e.key === "Escape") handleCancelRename?.(e as any);
        }}
        aria-label="Rename conversation"
        className="w-full min-w-0 flex-1 border-none bg-transparent p-0 text-inherit outline-none"
      />
      <IconButton
        size="small"
        aria-label="Confirm rename"
        onClick={(e) => handleConfirmRename?.(e, conv.id)}
      >
        <Check />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Cancel rename"
        onClick={handleCancelRename}
      >
        <X />
      </IconButton>
    </Box>
  ) : (
    <Box className="flex min-w-0 flex-1 items-center gap-1.5">
      {onToggleSelect ? (
        <Box
          className={cn(
            "checkbox-icon grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity",
            selected && "opacity-100 text-primary",
          )}
          role="checkbox"
          tabIndex={0}
          aria-label={`Select ${conv.title || "Untitled"}`}
          aria-checked={selected}
          onClick={(e) => onToggleSelect(e, conv.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleSelect(e as unknown as React.MouseEvent, conv.id);
            }
          }}
        >
          {selected ? <Check size={14} strokeWidth={3} /> : <Circle size={14} />}
        </Box>
      ) : null}
      <Typography
        variant="body2"
        noWrap
        as="div"
        className="min-w-0 flex-1"
      >
        {isGenerating ? (
          <TextShimmer duration={1.8} spread={18}>
            {conv.title || "Untitled"}
          </TextShimmer>
        ) : (
          conv.title || "Untitled"
        )}
      </Typography>

      {isGenerating ? (
        <Box
          className="grid size-5 shrink-0 place-items-center text-muted-foreground"
        >
          <Spinner className="size-3" />
        </Box>
      ) : (
        <Box
          className="conversation-actions shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="small"
                aria-label={`Actions for ${conv.title || "Untitled"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => handleStartRename?.(e, conv)}>
                <Edit2 size={14} /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleArchive?.(conv.id)}>
                <Archive size={14} /> Archive
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport?.(conv)}>
                <Download size={14} /> Export
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => handleStartDelete?.(conv)}>
                <Trash2 size={14} /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Box>
      )}
    </Box>
  );

  if (isFolder) {
    return (
      <ButtonBase
        // The row embeds its own buttons (actions menu, rename controls) and
        // HTML forbids button-in-button, so render a div with button semantics.
        as="div"
        role="button"
        tabIndex={0}
        onKeyDown={activateRowOnKeyDown}
        onClick={onClick}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1.5 rounded-lg p-1.5 text-left text-sm hover:bg-muted",
          isActive && "bg-muted",
        )}
      >
        {content}
      </ButtonBase>
    );
  }

  return (
    <Box
      className="group flex h-full w-full min-w-0 items-center rounded-lg text-left text-sm"
      onClick={onClick}
    >
      {content}
    </Box>
  );
});
