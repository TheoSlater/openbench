import { ModelProvider, OllamaModel, PullProgress } from "@/store/modelStore";
import {
  Box,
  Select,
  MenuItem,
  Typography,
  FormControl,
  Link,
  Tooltip,
  IconButton,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import { X, ChevronDown, Eye, Plus, Settings2, AlertCircle } from "lucide-react";

interface HeaderProps {
  availableModels: {
    ollama: OllamaModel[];
    anthropic: string[];
    openai: string[];
  };
  selectedModels: string[];
  // selectedProviders: ModelProvider[];
  onModelChange: (
    index: number,
    provider: ModelProvider,
    model: string,
  ) => void;
  onAddModel: () => void;
  onRemoveModel: (index: number) => void;
  isLoading: boolean;
  ollamaError?: string | null;
  onSetDefault: (model: string) => void;
  onToggleInspector: () => void;
  isInspectorOpen: boolean;
  isTemporary?: boolean;
  onToggleTemporaryChat: () => void;
  pullingModel?: string | null;
  pullProgress?: PullProgress | null;
}

export function Header({
  availableModels,
  selectedModels,
  // selectedProviders,
  onModelChange,
  onAddModel,
  onRemoveModel,
  isLoading,
  ollamaError,
  onSetDefault,
  onToggleInspector,
  isInspectorOpen,
  isTemporary,
  onToggleTemporaryChat,
  pullingModel,
  pullProgress,
}: HeaderProps) {
  const hasAnyModels = availableModels.ollama.length > 0;
  const isOllamaLoading = isLoading && !hasAnyModels;

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        minHeight: 56,
        flexShrink: 0,
        alignItems: "flex-start",
        justifyContent: "space-between",
        bgcolor: "transparent",
        px: { xs: 2, md: 3 },
        pt: 1.5,
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {pullingModel ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 200, px: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.primary" }}>
                  Pulling {pullingModel}...
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {pullProgress?.completed && pullProgress.total 
                    ? `${Math.round((pullProgress.completed / pullProgress.total) * 100)}%`
                    : pullProgress?.status || "Starting..."}
                </Typography>
              </Box>
              <LinearProgress 
                variant={pullProgress?.completed && pullProgress.total ? "determinate" : "indeterminate"}
                value={pullProgress?.completed && pullProgress.total ? (pullProgress.completed / pullProgress.total) * 100 : undefined}
                sx={{ height: 4, borderRadius: 2, bgcolor: "action.hover" }}
              />
            </Box>
          ) : (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                {selectedModels.map((selectedModel, index) => (
                  <Box key={`${selectedModel}-${index}`} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <FormControl size="small">
                      <Select
                        value={selectedModel}
                        onChange={(e) => onModelChange(index, "ollama", e.target.value as string)}
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
                            },
                          },
                        }}
                      >
                        {isOllamaLoading ? (
                          <MenuItem value="" disabled>
                            <CircularProgress size={16} sx={{ mr: 1 }} />
                            Connecting to Ollama...
                          </MenuItem>
                        ) : !hasAnyModels ? (
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
                                      style={{ marginLeft: 8 }}
                                    />
                                  </Tooltip>
                                )}
                              </Box>
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                    {selectedModels.length > 1 && (
                      <IconButton
                        size="small"
                        onClick={() => onRemoveModel(index)}
                        sx={{ p: 0.5, color: "text.secondary" }}
                      >
                        <X size={14} />
                      </IconButton>
                    )}
                  </Box>
                ))}
                <Box
                  onClick={onAddModel}
                  sx={{
                    color: "text.secondary",
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    ml: 1,
                    "&:hover": { color: "text.primary" },
                  }}
                >
                  <Plus size={16} />
                </Box>
              </Box>
              <Link
                component="button"
                variant="caption"
                underline="none"
                onClick={() => onSetDefault(selectedModels[0])}
                disabled={!selectedModels[0]}
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
            </>
          )}
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {isLoading && hasAnyModels && (
          <Tooltip title="Updating models...">
            <CircularProgress size={16} color="inherit" sx={{ mr: 1, opacity: 0.5 }} />
          </Tooltip>
        )}
        {ollamaError && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "error.main", mr: 1 }}>
            <AlertCircle size={14} />
            <Typography
              variant="caption"
              sx={{ fontWeight: 500 }}
            >
              {ollamaError}
            </Typography>
          </Box>
        )}
        <Tooltip title={isTemporary ? "Disable Temporary Chat" : "Enable Temporary Chat"}>
          <Box
            onClick={onToggleTemporaryChat}
            sx={{
              p: 0.75,
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: isTemporary ? "primary.main" : "text.secondary",
              bgcolor: isTemporary ? "action.selected" : "transparent",
              "&:hover": {
                bgcolor: "action.hover",
                color: "text.primary",
              },
              transition: "all 0.2s ease-in-out",
            }}
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              style={{ width: 18, height: 18 }}
            >
              {isTemporary ? (
                <>
                  <path d="M8 12L11 15L16 10" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path
                    d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="2.5 3.5"
                  ></path>
                </>
              ) : (
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2.5 3.5"
                ></path>
              )}
            </svg>
          </Box>
        </Tooltip>
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
