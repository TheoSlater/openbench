import { SidebarTrigger } from "@/components/Layout/Sidebar";
import { Box, Select, MenuItem, Typography, FormControl } from "@mui/material";

interface HeaderProps {
  availableModels: {
    ollama: string[];
    anthropic: string[];
    openai: string[];
  };
  selectedModel: string;
  onModelChange: (provider: "ollama" | "anthropic" | "openai", model: string) => void;
  isLoading: boolean;
  ollamaError?: string | null;
}


export function Header({
  availableModels,
  selectedModel,
  onModelChange,
  isLoading,
  ollamaError,
}: HeaderProps) {
  const hasAnyModels = availableModels.ollama.length > 0;
  const selectedValue = selectedModel || "";

  const handleChange = (value: string) => {
    if (!value) return;
    onModelChange("ollama", value);
  };

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        height: 56,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        bgcolor: "#0d0d0d",
        px: { xs: 2, md: 3 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ display: { xs: "block", md: "block" } }}>
          <SidebarTrigger sx={{ mr: 1, color: "rgba(255, 255, 255, 0.4)" }} />
        </Box>
        {ollamaError && (
          <Typography variant="caption" sx={{ color: "rgba(248, 113, 113, 0.6)" }}>
            {ollamaError}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <FormControl size="small">
          <Select
            value={selectedValue}
            onChange={(e) => handleChange(e.target.value as string)}
            disabled={isLoading || !hasAnyModels}
            displayEmpty
            sx={{
              height: 36,
              minWidth: { xs: 120, sm: 180 },
              borderRadius: "12px",
              bgcolor: "#1a1a1a",
              color: "rgba(255, 255, 255, 0.9)",
              fontSize: "14px",
              fontWeight: 500,
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255, 255, 255, 0.1)",
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255, 255, 255, 0.2)",
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255, 255, 255, 0.2)",
                borderWidth: "1px",
              },
              "& .MuiSelect-icon": {
                color: "rgba(255, 255, 255, 0.2)",
                right: 8,
              },
              "& .MuiSelect-select": {
                pr: "32px !important",
              }
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  bgcolor: "#1a1a1a",
                  color: "#fff",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  "& .MuiMenuItem-root": {
                    fontSize: "14px",
                    "&:hover": {
                      bgcolor: "rgba(255, 255, 255, 0.05)",
                    },
                    "&.Mui-selected": {
                      bgcolor: "rgba(255, 255, 255, 0.1)",
                      "&:hover": {
                        bgcolor: "rgba(255, 255, 255, 0.15)",
                      }
                    }
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
  );
}
