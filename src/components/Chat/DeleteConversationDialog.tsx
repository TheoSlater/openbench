import { Box, Typography } from "@mui/material";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Box sx={{ p: 4, minWidth: { xs: "90vw", sm: 400 }, maxWidth: 500 }}>
          <DialogTitle>
            <Typography variant="h6" sx={{ fontWeight: 600, color: "#fff", mb: 2 }}>
              Delete chat?
            </Typography>
          </DialogTitle>
          
          <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.6)", mb: 4, lineHeight: 1.6 }}>
            This will delete <Box component="span" sx={{ fontWeight: 600, color: "rgba(255, 255, 255, 0.9)" }}>{title}</Box>. This action cannot be undone.
          </Typography>

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5 }}>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              sx={{
                bgcolor: "transparent",
                borderColor: "rgba(255, 255, 255, 0.1)",
                color: "rgba(255, 255, 255, 0.8)",
                "&:hover": {
                  bgcolor: "rgba(255, 255, 255, 0.05)",
                  borderColor: "rgba(255, 255, 255, 0.2)",
                  color: "#fff",
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
                bgcolor: "#ef4444",
                color: "#fff",
                "&:hover": {
                  bgcolor: "#dc2626",
                },
              }}
            >
              Delete
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
