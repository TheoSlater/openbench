import * as React from "react";
import { Box, Typography, TextField, Button, Stack, Alert } from "@mui/material";
import { useSettingsStore } from "@/store/settingsStore";
import { RefreshCw } from "lucide-react";

export function GeneralSettingsPanel() {
  const { ollamaConfig, actions } = useSettingsStore();
  const [baseUrl, setBaseUrl] = React.useState(ollamaConfig.baseUrl);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBaseUrl(ollamaConfig.baseUrl);
  }, [ollamaConfig.baseUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await actions.setOllamaConfig({ baseUrl });
    } catch (err: any) {
      setError(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setBaseUrl("http://localhost:11434");
  };

  return (
    <Box sx={{ display: "flex", width: "100%", flexDirection: "column", gap: 4 }}>
      <Box component="section">
        <Box sx={{ mb: 3, display: "flex", flexDirection: "column", gap: 0.5 }}>
          <Typography
            component="label"
            htmlFor="ollama-url"
            sx={{ fontSize: "0.875rem", fontWeight: 700, color: "text.primary" }}
          >
            Ollama Base URL
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.6 }}>
            The address where your Ollama instance is running.
          </Typography>
        </Box>
        
        <Stack spacing={2}>
          <TextField
            id="ollama-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434"
            fullWidth
            size="small"
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "12px",
                bgcolor: "action.hover",
                fontSize: "14px",
                transition: "all 0.2s",
                "& fieldset": { borderColor: "divider" },
                "&:hover fieldset": { borderColor: "border.main" },
                "&.Mui-focused fieldset": { borderColor: "border.main" },
              }
            }}
          />
          
          {error && (
            <Alert severity="error" sx={{ borderRadius: "12px" }}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={isSaving || (baseUrl === ollamaConfig.baseUrl)}
              sx={{
                borderRadius: "12px",
                textTransform: "none",
                px: 4,
                boxShadow: "none",
                "&:hover": { boxShadow: "none" }
              }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              variant="outlined"
              onClick={handleReset}
              startIcon={<RefreshCw size={16} />}
              sx={{
                borderRadius: "12px",
                textTransform: "none",
                borderColor: "divider",
                color: "text.secondary",
                "&:hover": { borderColor: "border.main", bgcolor: "action.hover" }
              }}
            >
              Reset to Default
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box component="section">
        <Typography
          sx={{ fontSize: "0.875rem", fontWeight: 700, color: "text.primary", mb: 1 }}
        >
          About OpenBench
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          OpenBench is a local-first AI client for comparing and interacting with various models.
          All your data is stored locally in your browser and your machine.
        </Typography>
      </Box>
    </Box>
  );
}
