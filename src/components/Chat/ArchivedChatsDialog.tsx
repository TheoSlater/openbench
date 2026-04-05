import { Box, Typography, Stack, InputBase } from "@mui/material";
import { Modal } from "@/components/ui/modal";
import { useChatStore } from "@/store/chatStore";
import { ArchiveRestore, Trash2, Search, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ArchivedChatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArchivedChatsDialog({
  open,
  onOpenChange,
}: ArchivedChatsDialogProps) {
  const { conversations, actions } = useChatStore();
  const [searchQuery, setSearchQuery] = useState("");
  
  const archivedConversations = conversations
    .filter((c) => c.isArchived)
    .filter((c) => 
      (c.title || "Untitled").toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title="Archived Chats"
      maxWidth={450}
      height={550}
      contentSx={{ p: 0, display: "flex", flexDirection: "column" }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            height: 36,
            borderRadius: "8px",
            bgcolor: "action.hover",
            color: "text.secondary",
            border: "1px solid",
            borderColor: "transparent",
            "&:focus-within": {
              borderColor: "primary.main",
              bgcolor: "background.paper",
            }
          }}
        >
          <Search size={16} />
          <InputBase
            placeholder="Search archived chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{
              flex: 1,
              fontSize: "14px",
              color: "text.primary",
              "& .MuiInputBase-input::placeholder": {
                color: "text.secondary",
                opacity: 0.7,
              }
            }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", p: 1 }}>
        {archivedConversations.length === 0 ? (
          <Stack sx={{ height: "100%", alignItems: "center", justifyContent: "center", color: "text.secondary", py: 8 }} spacing={1.5}>
            <Box sx={{ 
              width: 48, 
              height: 48, 
              borderRadius: "12px", 
              bgcolor: "action.hover", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              mb: 1
            }}>
              <ArchiveRestore size={24} style={{ opacity: 0.5 }} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {searchQuery ? "No matching chats" : "No archived chats"}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {searchQuery ? "Try a different search term" : "Your archived conversations will appear here"}
            </Typography>
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
                  borderRadius: "8px",
                  cursor: "default",
                  transition: "all 0.2s",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:hover .action-buttons": { opacity: 1 }
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, mr: 2, gap: 1.5 }}>
                  <Box sx={{ 
                    color: "text.secondary", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    flexShrink: 0
                  }}>
                    <MessageSquare size={18} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "text.primary" }}>
                      {conv.title || "Untitled"}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
                      Archived on {new Date(conv.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Typography>
                  </Box>
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
                    sx={{ h: 32, w: 32, color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: "primary.main", opacity: 0.1, "& .lucide": { color: "primary.main" } } }}
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
                    sx={{ h: 32, w: 32, color: "text.secondary", "&:hover": { color: "error.main", bgcolor: "error.main", opacity: 0.1, "& .lucide": { color: "error.main" } } }}
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
      </Box>
    </Modal>
  );
}
