import { useSettingsStore } from "@/store/settingsStore";
import { useThemeStore, ThemeMode } from "@/store/themeStore";
import { SystemPrompt, useModelStore } from "@/store/modelStore";
import { Modal } from "@/components/ui/modal";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Settings, UserCircle, X, Sun, Moon, Monitor } from "lucide-react";
import {
  Box,
  Typography,
  useTheme,
  IconButton,
  TextField,
  Button,
  Alert,
  MenuItem,
  Select,
  FormControl,
} from "@mui/material";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const SIDEBAR_ITEMS = [
  { id: "general", label: "General", icon: Settings },
  { id: "personalization", label: "Personalization", icon: UserCircle },
];

const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

/**
 * Settings modal overlay with ChatGPT-style sidebar navigation.
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const muiTheme = useTheme();
  const [activeTab, setActiveTab] = useState("general");

  // --- General Settings State ---
  const { ollamaConfig, actions: settingsActions } = useSettingsStore();
  const { mode, setMode } = useThemeStore();
  const [baseUrl, setBaseUrl] = useState(ollamaConfig.baseUrl);
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(ollamaConfig.baseUrl);
  }, [ollamaConfig.baseUrl]);

  const handleSaveBaseUrl = async () => {
    setIsSavingBaseUrl(true);
    setBaseUrlError(null);
    try {
      await settingsActions.setOllamaConfig({ baseUrl });
    } catch (err: any) {
      setBaseUrlError(err.message || "Failed to save settings");
    } finally {
      setIsSavingBaseUrl(false);
    }
  };

  // --- Personalization State ---
  const {
    systemPrompts,
    activeSystemPromptId,
    actions: modelActions,
  } = useModelStore();
  const activePrompt = useMemo(
    () => systemPrompts.find((p) => p.id === activeSystemPromptId) ?? null,
    [activeSystemPromptId, systemPrompts],
  );
  const [personalizationContent, setPersonalizationContent] = useState("");

  useEffect(() => {
    setPersonalizationContent(activePrompt?.content ?? "");
  }, [activePrompt]);

  const handleSavePersonalization = useCallback(() => {
    const nextPrompt: SystemPrompt = {
      id: activePrompt?.id ?? "default",
      name: activePrompt?.name ?? "Default",
      content: personalizationContent,
      baseStyle: activePrompt?.baseStyle ?? "default",
      characteristics: activePrompt?.characteristics ?? [],
      instantAnswers: activePrompt?.instantAnswers ?? false,
    };
    if (activePrompt) {
      modelActions.updateSystemPrompt(nextPrompt);
    } else {
      modelActions.addSystemPrompt(nextPrompt);
      modelActions.setSystemPrompt(nextPrompt.id);
    }
  }, [activePrompt, personalizationContent, modelActions]);

  const handleClose = () => {
    if (activeTab === "personalization") {
      handleSavePersonalization();
    }
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      maxWidth={800}
      showCloseButton={false}
      contentSx={{ p: 0, overflow: "hidden" }}
      sx={{
        "& .MuiPaper-root": {
          borderRadius: "12px",
          bgcolor: "background.sidebar",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          height: "min(600px, 85vh)",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {/* Left Sidebar */}
        <Box
          component="aside"
          sx={{
            display: { xs: "none", md: "flex" },
            width: 240,
            flexShrink: 0,
            flexDirection: "column",
            bgcolor: "background.sidebar",
            px: 2,
            py: 2,
          }}
        >
          <Box
            component="nav"
            sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 4 }}
          >
            {SIDEBAR_ITEMS.map((item) => (
              <Box
                key={item.id}
                onClick={() => {
                  if (activeTab === "personalization")
                    handleSavePersonalization();
                  setActiveTab(item.id);
                }}
                component="button"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  width: "100%",
                  border: "none",
                  borderRadius: "8px",
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  background:
                    activeTab === item.id
                      ? muiTheme.palette.action.hover
                      : "transparent",
                  color:
                    activeTab === item.id
                      ? muiTheme.palette.text.primary
                      : muiTheme.palette.text.secondary,
                  "&:hover": {
                    background: muiTheme.palette.action.hover,
                    color: muiTheme.palette.text.primary,
                  },
                }}
              >
                <item.icon size={18} />
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: activeTab === item.id ? 600 : 500,
                    fontSize: "14px",
                  }}
                >
                  {item.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Main Content Area */}
        <Box
          sx={{
            display: "flex",
            height: "100%",
            minWidth: 0,
            flex: 1,
            flexDirection: "column",
            bgcolor: "background.default",
            position: "relative",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 4,
              pt: 3,
              pb: 1,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: "18px" }}>
              Settings
            </Typography>
            <IconButton
              size="small"
              onClick={handleClose}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "text.primary" },
              }}
            >
              <X size={20} />
            </IconButton>
          </Box>

          {/* Content */}
          <Box
            component="main"
            sx={{
              minHeight: 0,
              flex: 1,
              px: 4,
              py: 2,
              overflowY: "auto",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Box sx={{ width: "100%", maxWidth: "600px" }}>
              {activeTab === "general" && (
                <Box
                  sx={{
                    display: "flex",
                    width: "100%",
                    flexDirection: "column",
                  }}
                >
                  {/* Theme Section */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      py: 2,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Typography
                      sx={{ fontSize: "14px", color: "text.primary" }}
                    >
                      Theme
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <Select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as ThemeMode)}
                        sx={{
                          borderRadius: "8px",
                          fontSize: "14px",
                          bgcolor: "action.hover",
                          "& .MuiOutlinedInput-notchedOutline": {
                            border: "none",
                          },
                          "&:hover .MuiOutlinedInput-notchedOutline": {
                            border: "none",
                          },
                          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                            border: "none",
                          },
                        }}
                      >
                        {THEME_OPTIONS.map((option) => (
                          <MenuItem
                            key={option.id}
                            value={option.id}
                            sx={{ fontSize: "14px" }}
                          >
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                              }}
                            >
                              <option.icon size={14} />
                              {option.label}
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  {/* Ollama Base URL Section */}
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      py: 2.5,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Typography
                        sx={{ fontSize: "14px", color: "text.primary" }}
                      >
                        Ollama Base URL
                      </Typography>
                      <Button
                        variant="text"
                        size="small"
                        onClick={handleSaveBaseUrl}
                        disabled={
                          isSavingBaseUrl || baseUrl === ollamaConfig.baseUrl
                        }
                        sx={{
                          textTransform: "none",
                          fontSize: "13px",
                          fontWeight: 500,
                          minWidth: 0,
                          p: 0,
                          "&:hover": {
                            bgcolor: "transparent",
                            textDecoration: "underline",
                          },
                        }}
                      >
                        {isSavingBaseUrl ? "Saving..." : "Save"}
                      </Button>
                    </Box>
                    <TextField
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      fullWidth
                      size="small"
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "8px",
                          bgcolor: "action.hover",
                          fontSize: "14px",
                          "& fieldset": { border: "none" },
                        },
                      }}
                    />
                    {baseUrlError && (
                      <Alert
                        severity="error"
                        sx={{ borderRadius: "8px", py: 0 }}
                      >
                        {baseUrlError}
                      </Alert>
                    )}
                  </Box>

                  {/* About Section */}
                  <Box sx={{ py: 2.5 }}>
                    <Typography
                      sx={{ fontSize: "14px", color: "text.primary", mb: 1 }}
                    >
                      About OpenBench
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: "13px",
                        color: "text.secondary",
                        lineHeight: 1.5,
                      }}
                    >
                      OpenBench is a local-first AI client for comparing and
                      interacting with various models. All your data is stored
                      locally in your machine.
                    </Typography>
                  </Box>
                </Box>
              )}

              {activeTab === "personalization" && (
                <Box
                  sx={{
                    display: "flex",
                    width: "100%",
                    flexDirection: "column",
                  }}
                >
                  <Box sx={{ py: 2 }}>
                    <Box
                      sx={{
                        mb: 1.5,
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                      }}
                    >
                      <Typography
                        component="label"
                        htmlFor="prompt-content"
                        sx={{
                          fontSize: "14px",
                          fontWeight: 500,
                          color: "text.primary",
                        }}
                      >
                        Custom instructions
                      </Typography>
                      <Typography
                        sx={{
                          color: "text.secondary",
                          fontSize: "13px",
                          lineHeight: 1.5,
                        }}
                      >
                        What would you like the AI to know to provide better
                        responses?
                      </Typography>
                    </Box>
                    <TextField
                      id="prompt-content"
                      multiline
                      minRows={10}
                      maxRows={15}
                      value={personalizationContent}
                      onChange={(e) =>
                        setPersonalizationContent(e.target.value)
                      }
                      placeholder="Example: I'm a developer working with React and Rust. Keep explanations concise..."
                      fullWidth
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          borderRadius: "8px",
                          bgcolor: "action.hover",
                          fontSize: "14px",
                          color: "text.primary",
                          lineHeight: 1.5,
                          "& fieldset": {
                            border: "none",
                          },
                          "&.Mui-focused": {
                            bgcolor: "action.hover",
                          },
                        },
                        "& .MuiInputBase-input::placeholder": {
                          color: "text.secondary",
                          opacity: 0.7,
                        },
                      }}
                    />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    </Modal>
  );
}
