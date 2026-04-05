import * as React from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  Stack,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Drawer,
} from "@mui/material";
import { X, ChevronDown, Clock, Hash, Code } from "lucide-react";
import { useInspectorStore } from "@/store/inspectorStore";
import { InspectorPayload } from "@/types/inspector";

interface InspectorPanelProps {
  onClose: () => void;
}

const maskSensitiveData = (obj: any): any => {
  if (!obj) return obj;
  const sensitiveKeys = ["api_key", "apiKey", "secret", "token", "password", "authorization"];
  const masked = JSON.parse(JSON.stringify(obj));

  const mask = (current: any) => {
    if (typeof current !== "object" || current === null) return;
    for (const key in current) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        current[key] = "********";
      } else if (typeof current[key] === "object") {
        mask(current[key]);
      }
    }
  };

  mask(masked);
  return masked;
};

const JsonView = ({ data }: { data: any }) => (
  <Box
    component="pre"
    sx={{
      p: 2,
      borderRadius: 1,
      bgcolor: "action.hover",
      fontSize: "0.75rem",
      overflowX: "auto",
      fontFamily: "monospace",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      maxHeight: "300px",
      overflowY: "auto",
    }}
  >
    {JSON.stringify(maskSensitiveData(data), null, 2)}
  </Box>
);

const LogItem = ({ log }: { log: InspectorPayload }) => {
  const [tab, setTab] = React.useState(0);

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        "&:not(:last-child)": { borderBottom: 0 },
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDown size={18} />}
        sx={{
          px: 2,
          "& .MuiAccordionSummary-content": {
            overflow: "hidden",
          },
        }}
      >
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ width: "100%", overflow: "hidden" }}
        >
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, minWidth: 60, flexShrink: 0 }}
          >
            {log.request.method}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ flexGrow: 1, minWidth: 0 }}
          >
            {log.model}
          </Typography>
          <Chip
            size="small"
            label={log.response ? "200" : "Wait"}
            color={log.response ? "success" : "warning"}
            variant="outlined"
            sx={{ height: 20, fontSize: "0.7rem", flexShrink: 0 }}
          />
          {log.timing.totalTime && (
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              sx={{ flexShrink: 0 }}
            >
              <Clock size={12} />
              <Typography variant="caption" sx={{ fontSize: "0.7rem" }}>
                {log.timing.totalTime}ms
              </Typography>
            </Stack>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0, borderTop: "1px solid", borderColor: "divider" }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ minHeight: 40, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab label="Request" sx={{ fontSize: "0.75rem", minHeight: 40 }} />
          <Tab label="Response" sx={{ fontSize: "0.75rem", minHeight: 40 }} />
          <Tab label="Metadata" sx={{ fontSize: "0.75rem", minHeight: 40 }} />
        </Tabs>
        <Box sx={{ p: 2 }}>
          {tab === 0 && <JsonView data={log.request.body} />}
          {tab === 1 && (
            log.response ? (
              <JsonView data={log.response.body} />
            ) : (
              <Typography variant="body2" color="text.secondary" align="center">
                Waiting for response...
              </Typography>
            )
          )}
          {tab === 2 && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Clock size={14} /> TIMING
                </Typography>
                <Stack spacing={1}>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Time to First Token</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.timing.firstTokenTime ?? "N/A"} ms</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Total Latency</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.timing.totalTime ?? "N/A"} ms</Typography>
                  </Box>
                </Stack>
              </Box>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Hash size={14} /> TOKENS
                </Typography>
                <Stack spacing={1}>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Prompt Tokens</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.tokens?.input ?? "N/A"}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Completion Tokens</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.tokens?.output ?? "N/A"}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Total Tokens</Typography>
                    <Typography variant="body2" fontWeight={500}>{(log.tokens?.input || 0) + (log.tokens?.output || 0) || "N/A"}</Typography>
                  </Box>
                </Stack>
              </Box>
              <Divider />
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                  <Code size={14} /> MODEL INFO
                </Typography>
                <Stack spacing={1}>
                   <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Model</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.model}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="body2">Endpoint</Typography>
                    <Typography variant="body2" fontWeight={500}>{log.request.url}</Typography>
                  </Box>
                </Stack>
              </Box>
            </Stack>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

export const InspectorPanel: React.FC<InspectorPanelProps & { open: boolean }> = ({ onClose, open }) => {
  const logs = useInspectorStore((state) => state.logs);
  const { clearLogs } = useInspectorStore.getState().actions;

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open={open}
      sx={{
        width: 350,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: 350,
          boxSizing: "border-box",
          top: "56px",
          height: "calc(100% - 56px)",
          borderLeft: "1px solid",
          borderColor: "divider",
          boxShadow: "none",
        },
      }}
    >
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Typography
          variant="h6"
          sx={{ fontSize: "0.9rem", fontWeight: 700, flexGrow: 1 }}
        >
          Inspector
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            size="small"
            onClick={() => {
              console.log("Clearing logs...");
              clearLogs();
            }}
            title="Clear Logs"
            sx={{ borderRadius: 1, px: 1, height: 28 }}
          >
            <Typography
              variant="caption"
              color="primary"
              sx={{ fontWeight: 600, fontSize: "0.7rem" }}
            >
              CLEAR
            </Typography>
          </IconButton>
          <IconButton size="small" onClick={onClose} title="Close Panel">
            <X size={18} />
          </IconButton>
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
        {logs.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center", opacity: 0.5 }}>
            <Typography variant="body2">No logs yet.</Typography>
            <Typography variant="caption">Requests will appear here as they happen.</Typography>
          </Box>
        ) : (
          logs.map((log) => <LogItem key={log.id} log={log} />)
        )}
      </Box>
    </Drawer>
  );
};
