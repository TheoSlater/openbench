import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  Checkbox,
  FormControlLabel,
  useTheme,
} from "@mui/material";
import { ShieldAlert, Terminal, FileText, Globe } from "lucide-react";
import { useToolStore } from "@/store/toolStore";
import { useState } from "react";

// Map tool names to icons for visual identification
const toolIcons: Record<string, React.ReactNode> = {
  execute_shell: <Terminal size={20} />,
  read_file: <FileText size={20} />,
  search_web: <Globe size={20} />,
};

const ToolApproval: React.FC = () => {
  const theme = useTheme();
  const pendingApproval = useToolStore((s) => s.pendingApproval);
  const { approveToolCall, denyToolCall } = useToolStore((s) => s.actions);
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  if (!pendingApproval) return null;

  const icon = toolIcons[pendingApproval.toolName] || (
    <ShieldAlert size={20} />
  );

  const formatArgs = (args: Record<string, unknown>) => {
    return Object.entries(args)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n");
  };

  return (
    <Dialog
      open={!!pendingApproval}
      onClose={() => denyToolCall(pendingApproval.invocationId)}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: "12px",
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", gap: 1.5, pb: 1 }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "8px",
            bgcolor: "warning.main",
            color: "warning.contrastText",
            flexShrink: 0,
          }}
        >
          <ShieldAlert size={20} />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Tool Approval Required
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mb: 2,
          }}
        >
          <Box sx={{ color: "text.secondary" }}>{icon}</Box>
          <Chip
            label={pendingApproval.toolName}
            size="small"
            sx={{
              fontFamily: "monospace",
              fontWeight: 600,
              bgcolor:
                theme.palette.mode === "dark"
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.06)",
            }}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The model wants to execute this tool. Review the arguments below:
        </Typography>

        <Box
          sx={{
            p: 2,
            borderRadius: "8px",
            bgcolor:
              theme.palette.mode === "dark"
                ? "rgba(0,0,0,0.3)"
                : "rgba(0,0,0,0.04)",
            border: `1px solid ${theme.palette.divider}`,
            fontFamily: "monospace",
            fontSize: "13px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {formatArgs(pendingApproval.toolArgs)}
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={alwaysAllow}
              onChange={(e) => setAlwaysAllow(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              Always allow <strong>{pendingApproval.toolName}</strong> without
              asking
            </Typography>
          }
          sx={{ mt: 2 }}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={() => denyToolCall(pendingApproval.invocationId)}
          variant="outlined"
          sx={{
            borderColor: theme.palette.divider,
            color: "text.secondary",
            textTransform: "none",
          }}
        >
          Deny
        </Button>
        <Button
          onClick={() =>
            approveToolCall(pendingApproval.invocationId, alwaysAllow)
          }
          variant="contained"
          color="primary"
          sx={{ textTransform: "none" }}
        >
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ToolApproval;
