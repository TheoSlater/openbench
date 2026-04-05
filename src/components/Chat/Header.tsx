import { OllamaModel } from "@/store/modelStore";
import {
  Box,
  Select,
  MenuItem,
  Typography,
  FormControl,
  Link,
  Tooltip,
} from "@mui/material";
import { ChevronDown, Plus, Eye, Settings2 } from "lucide-react";

interface HeaderProps {
  availableModels: {
    ollama: OllamaModel[];
    anthropic: string[];
    openai: string[];
  };
  selectedModel: string;
  onModelChange: (
    provider: "ollama" | "anthropic" | "openai",
    model: string,
  ) => void;
  isLoading: boolean;
  ollamaError?: string | null;
  onSetDefault: (model: string) => void;
  onToggleInspector: () => void;
  isInspectorOpen: boolean;
}

export function Header({
  availableModels,
  selectedModel,
  onModelChange,
  isLoading,
  ollamaError,
  onSetDefault,
  onToggleInspector,
  isInspectorOpen,
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
        bgcolor: "transparent",
        px: { xs: 2, md: 3 },
        pt: 1,
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FormControl size="small">
            <Select
              value={selectedValue}
              onChange={(e) => handleChange(e.target.value as string)}
              disabled={isLoading || !hasAnyModels}
              displayEmpty
              IconComponent={(props) => (
                <ChevronDown
                  {...props}
                  size={14}
                  style={{ color: "text.secondary" }}
                />
              )}
              sx={{
                height: 32,
                color: "primary.main",
                fontSize: "15px",
                fontWeight: 600,
                opacity: 1,
                "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                "& .MuiSelect-select": {
                  p: 0,
                  pr: "20px !important",
                  display: "flex",
                  alignItems: "center",
                },
                "& .MuiSelect-icon": {
                  right: 0,
                  top: "calc(50% - 7px)",
                },
              }}
              MenuProps={{
                PaperProps: {
                  sx: {
                    bgcolor: "background.paper",
                    color: "text.primary",
                    mt: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    "& .MuiMenuItem-root": {
                      fontSize: "14px",
                      "&:hover": { bgcolor: "action.hover" },
                      "&.Mui-selected": { bgcolor: "action.selected" },
                    },
                  },
                },
              }}
            >
              {!hasAnyModels ? (
                <MenuItem value="">No models</MenuItem>
              ) : (
                availableModels.ollama.map((model) => (
                  <MenuItem
                    key={model.name.toString()}
                    value={model.name.toString()}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <Typography variant="body2">{model.name}</Typography>
                      {model.supports_vision && (
                        <Tooltip title="Supports vision">
                          <Eye
                            size={14}
                            style={{ marginLeft: 8, opacity: 0.6 }}
                          />
                        </Tooltip>
                      )}
                    </Box>
                  </MenuItem>
                ))
              )}
              <MenuItem divider sx={{ my: 0.5, opacity: 0.1 }} />
              <MenuItem
                onClick={() => onSetDefault(selectedModel)}
                disabled={!selectedModel}
                sx={{ fontSize: "13px", color: "text.secondary" }}
              >
                Set as default
              </MenuItem>
            </Select>
          </FormControl>
          <Box
            sx={{
              color: "text.secondary",
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <Plus size={16} />
          </Box>
        </Box>
        <Link
          component="button"
          variant="caption"
          underline="none"
          onClick={() => onSetDefault(selectedModel)}
          disabled={!selectedModel}
          sx={{
            color: "text.secondary",
            fontSize: "11px",
            textAlign: "left",
            ml: 0.2,
            "&:hover": { color: "text.primary" },
          }}
        >
          Set as default
        </Link>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {ollamaError && (
          <Typography
            variant="caption"
            sx={{ color: "error.main", mr: 1, opacity: 0.6 }}
          >
            {ollamaError}
          </Typography>
        )}
        <Tooltip title={isInspectorOpen ? "Close Inspector" : "Open Inspector"}>
          <Box
            onClick={onToggleInspector}
            sx={{
              p: 0.75,
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: isInspectorOpen ? "primary.main" : "text.secondary",
              bgcolor: isInspectorOpen ? "action.selected" : "transparent",
              "&:hover": {
                bgcolor: "action.hover",
                color: "text.primary",
              },
              transition: "all 0.2s ease-in-out",
            }}
          >
            <Settings2 size={18} />
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
}
