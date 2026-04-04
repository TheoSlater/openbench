import { Box, Typography, MenuItem, Select, FormControl } from "@mui/material";

interface EmptyStateProps {
  selectedModel: string;
  availableModels: {
    ollama: string[];
    anthropic: string[];
    openai: string[];
  };
  onModelChange: (provider: "ollama" | "anthropic" | "openai", model: string) => void;
  isLoading: boolean;
  children?: React.ReactNode;
}

export function EmptyState({
  selectedModel,
  availableModels,
  onModelChange,
  isLoading,
  children,
}: EmptyStateProps) {
  const hasAnyModels = availableModels.ollama.length > 0;
  const selectedValue = selectedModel || "";

  const handleChange = (value: string) => {
    if (!value) return;
    onModelChange("ollama", value);
  };

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", px: 2, maxWidth: 768, mx: "auto", width: "100%" }}>
      {/* Model Selector Dropdown */}
      <Box sx={{ mb: 2, position: "relative" }}>
        <Box sx={{ position: "relative" }}>
          <FormControl size="small">
            <Select
              value={selectedValue}
              onChange={(e) => handleChange(e.target.value as string)}
              disabled={isLoading || !hasAnyModels}
              displayEmpty
              renderValue={(selected) => (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, pr: 3 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, color: "rgba(255, 255, 255, 0.9)", letterSpacing: "-0.01em" }}>
                    {selected || "gpt-4.1-nano"}
                  </Typography>
                </Box>
              )}
              sx={{
                "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                "& .MuiSelect-select": { p: 1, borderRadius: "16px", "&:hover": { bgcolor: "rgba(255, 255, 255, 0.05)" } },
                "& .MuiSelect-icon": { 
                  display: "block",
                  color: "rgba(255, 255, 255, 0.2)",
                  right: 4,
                  fontSize: "24px",
                },
              }}
              MenuProps={{
                PaperProps: {
                  sx: {
                    bgcolor: "#1a1a1a",
                    color: "#fff",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    "& .MuiMenuItem-root": {
                      fontSize: "14px",
                      "&:hover": { bgcolor: "rgba(255, 255, 255, 0.05)" },
                      "&.Mui-selected": { bgcolor: "rgba(255, 255, 255, 0.1)" }
                    }
                  }
                }
              }}
            >
              {!hasAnyModels ? (
                <MenuItem value="">No models</MenuItem>
              ) : (
                availableModels.ollama.map((model) => (
                  <MenuItem key={model} value={model}>
                    {model}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Input area rendered here when in empty state */}
      <Box sx={{ width: "100%", mt: 1 }}>
        {children}
      </Box>
    </Box>
  );
}
