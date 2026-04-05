import { Box, Typography } from "@mui/material";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface DeleteConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
}

export function DeleteConversationDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
}: DeleteConversationDialogProps) {
  return (
    <Modal 
      open={open} 
      onOpenChange={onOpenChange} 
      title="Delete chat?"
      maxWidth={400}
      contentSx={{ p: 3 }}
      footer={
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5 }}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            sx={{
              bgcolor: "transparent",
              borderColor: "divider",
              color: "text.secondary",
              "&:hover": {
                bgcolor: "action.hover",
                borderColor: "border.main",
                color: "text.primary",
              },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            sx={{
              bgcolor: "error.main",
              color: "error.contrastText",
              "&:hover": {
                bgcolor: "error.dark",
              },
            }}
          >
            Delete
          </Button>
        </Box>
      }
    >
      <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
        This will delete <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>{title}</Box>. This action cannot be undone.
      </Typography>
    </Modal>
  );
}
