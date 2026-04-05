import { Box, Typography, Stack } from "@mui/material";
import { Modal } from "@/components/ui/modal";
import { useChatStore } from "@/store/chatStore";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ArchivedChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchivedChatsDialog({
  open,
  onOpenChange,
}: ArchivedChatsDialogProps) {
  const { conversations, actions } = useChatStore();
  const archivedConversations = conversations.filter((c) => c.isArchived);

  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title="Archived Chats"
      maxWidth={500}
      height={500}
      contentSx={{ p: 1 }}
    >
      {archivedConversations.length === 0 ? (
        <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary" }} spacing={1}>
          <ArchiveRestore size={40} style={{ opacity: 0.2 }} />
          <Typography variant="body2">No archived chats</Typography>
        </Stack>
      ) : (
        <Stack spacing={0.5}>
          {archivedConversations.map((conv) => (
            <Box
              key={conv.id}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                p: 1.5,
                borderRadius: 1,
                transition: "background-color 0.2s",
                "&:hover": { bgcolor: "action.hover" },
                "&:hover .action-buttons": { opacity: 1 }
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0, mr: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {conv.title || "Untitled"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {new Date(conv.updatedAt).toLocaleDateString()}
                </Typography>
              </Box>
              <Stack 
                direction="row" 
                spacing={0.5} 
                className="action-buttons"
                sx={{ opacity: 0, transition: "opacity 0.2s" }}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  sx={{ h: 32, w: 32, color: "text.secondary", "&:hover": { color: "primary.main" } }}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.unarchiveConversation(conv.id);
                  }}
                  title="Restore"
                >
                  <ArchiveRestore size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  sx={{ h: 32, w: 32, color: "text.secondary", "&:hover": { color: "error.main" } }}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.deleteConversation(conv.id);
                  }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Modal>
  );
}
