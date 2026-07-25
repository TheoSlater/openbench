// Design: Quiet instrument panel — fixed-width shell, soft contrast, precise spacing.
import {
  AppDialogBody,
  AppDialogFrame,
  AppDialogHeader,
} from "@/components/ui/appDialog";
import { useChatStore } from "@/store/chatStore";
import { Box } from "@/components/ui/Box";
import { IconButton } from "@/components/ui/icon-button";
import { InputBase } from "@/components/ui/input-base";
import { Stack } from "@/components/ui/Stack";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { Typography } from "@/components/ui/Typography";
import { ArchiveRestore, MessageSquare, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeleteConversationDialog } from "@/features/chat/components/DeleteConversationDialog";

interface ArchivedChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchivedChatsDialog({
  open,
  onOpenChange,
}: ArchivedChatsDialogProps) {
  const conversations = useChatStore((s) => s.conversations);
  const actions = useChatStore((s) => s.actions);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const archivedConversations = conversations
    .filter((conversation) => conversation.isArchived)
    .filter((conversation) =>
      (conversation.title || "Untitled").toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <AppDialogFrame open={open} onOpenChange={onOpenChange}>
      <Box className="flex h-full min-h-0 flex-col">
        <AppDialogHeader
          title="Archived Chats"
          onClose={() => onOpenChange(false)}
        />

        <AppDialogBody>
          <Stack spacing={2}>
            <SearchField value={searchQuery} onChange={setSearchQuery} />

            {archivedConversations.length === 0 ? (
              <EmptyArchivedState hasSearch={searchQuery.length > 0} />
            ) : (
              <Stack spacing={0}>
                {archivedConversations.map((conversation) => (
                  <Box
                    key={conversation.id}
                    className="flex items-center justify-between gap-3 border-b border-border/60 p-3 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-soft)] hover:bg-muted/60"
                  >
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground">
                        <MessageSquare size={16} />
                      </Box>
                      <Box className="min-w-0">
                        <Typography className="truncate text-sm font-medium">
                          {conversation.title || "Untitled"}
                        </Typography>
                        <Typography color="muted" className="text-xs">
                          Archived on{" "}
                          {new Date(conversation.updatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Restore">
                        <IconButton
                          size="small"
                          aria-label={`Restore ${conversation.title || "Untitled"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            actions.unarchiveConversation(conversation.id);
                          }}
                        >
                          <ArchiveRestore size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          aria-label={`Delete ${conversation.title || "Untitled"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget({ id: conversation.id, title: conversation.title || "Untitled" });
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
        </AppDialogBody>
        <DeleteConversationDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget) void actions.deleteConversation(deleteTarget.id);
          }}
          title={deleteTarget?.title}
        />
      </Box>
    </AppDialogFrame>
  );
}

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Box className="flex h-10 items-center gap-2 border-b border-border/60 px-3 text-muted-foreground transition-colors duration-[var(--dur-fast)] ease-[var(--ease-soft)] focus-within:border-muted-foreground">
      <Search size={16} />
      <InputBase
        placeholder="Search archived chats..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Box>
  );
}

function EmptyArchivedState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <Stack
      spacing={1.25}
      alignItems="center"
      className="py-16 text-center"
    >
      <Box className="grid size-12 place-items-center rounded-lg text-muted-foreground">
        <ArchiveRestore size={24} />
      </Box>
      <Typography className="font-medium">
        {hasSearch ? "No matching chats" : "No archived chats"}
      </Typography>
      <Typography color="muted" className="text-sm">
        {hasSearch ? "Try a different search term" : "Your archived conversations will appear here"}
      </Typography>
    </Stack>
  );
}
