import { useSettingsStore } from "@/store/settingsStore";
import { useThemeStore, ThemeMode } from "@/store/themeStore";
import { SystemPrompt, useModelStore } from "@/store/modelStore";
import { useToolStore, type ToolDefinition } from "@/store/toolStore";
import { Modal } from "@/components/ui/modal";
import { useState, useEffect } from "react";
import { Settings, X, Sun, Moon, Monitor, Box as BoxIcon, Wrench, ScrollText, Plus, Trash2, Edit2, Check } from "lucide-react";
import { ModelManagement } from "./ModelManagement";
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
  { id: "models", label: "Models", icon: BoxIcon },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "prompts", label: "Prompt Library", icon: ScrollText },
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

  const handleClose = () => {
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

              {activeTab === "prompts" && <PromptLibraryTab />}

              {activeTab === "models" && (
                <Box sx={{ py: 2 }}>
                  <ModelManagement />
                </Box>
              )}

              {activeTab === "tools" && <ToolsTab />}
            </Box>
          </Box>
        </Box>
      </Box>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Prompt Library Tab Component
// ---------------------------------------------------------------------------

function PromptLibraryTab() {
  const { systemPrompts, activeSystemPromptId, actions } = useModelStore();
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const muiTheme = useTheme();

  const handleSave = (prompt: SystemPrompt) => {
    if (isAdding) {
      actions.addSystemPrompt(prompt);
      setIsAdding(false);
    } else {
      actions.updateSystemPrompt(prompt);
    }
    setEditingPrompt(null);
  };

  const handleAddNew = () => {
    const newPrompt: SystemPrompt = {
      id: crypto.randomUUID(),
      name: "New Prompt",
      content: "",
      category: "General",
    };
    setEditingPrompt(newPrompt);
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this prompt?")) {
      actions.deleteSystemPrompt(id);
    }
  };

  const categories = Array.from(new Set(systemPrompts.map(p => p.category || "General")));

  return (
    <Box sx={{ py: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography sx={{ fontSize: "14px", fontWeight: 500 }}>System Prompts</Typography>
        {!editingPrompt && (
          <Button
            size="small"
            startIcon={<Plus size={16} />}
            onClick={handleAddNew}
            sx={{ textTransform: "none" }}
          >
            Add New
          </Button>
        )}
      </Box>

      {editingPrompt ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, bgcolor: "action.hover", p: 2, borderRadius: "8px" }}>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Name"
              size="small"
              fullWidth
              value={editingPrompt.name}
              onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
            />
            <TextField
              label="Category"
              size="small"
              fullWidth
              value={editingPrompt.category || ""}
              onChange={(e) => setEditingPrompt({ ...editingPrompt, category: e.target.value })}
              placeholder="e.g. Coding, Creative, etc."
            />
          </Box>
          <TextField
            label="System Message"
            multiline
            minRows={8}
            fullWidth
            value={editingPrompt.content}
            onChange={(e) => setEditingPrompt({ ...editingPrompt, content: e.target.value })}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button size="small" variant="text" onClick={() => { setEditingPrompt(null); setIsAdding(false); }}>Cancel</Button>
            <Button size="small" variant="contained" onClick={() => handleSave(editingPrompt)}>Save</Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {categories.map(category => (
            <Box key={category} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {category}
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {systemPrompts.filter(p => (p.category || "General") === category).map(prompt => (
                  <Box
                    key={prompt.id}
                    sx={{
                      p: 1.5,
                      borderRadius: "8px",
                      bgcolor: "action.hover",
                      border: "1px solid",
                      borderColor: activeSystemPromptId === prompt.id ? "primary.main" : "transparent",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "all 0.2s",
                      "&:hover": { bgcolor: "action.selected" }
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => actions.setSystemPrompt(prompt.id)}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: activeSystemPromptId === prompt.id ? 600 : 500 }}>
                          {prompt.name}
                        </Typography>
                        {activeSystemPromptId === prompt.id && (
                          <Check size={14} style={{ color: muiTheme.palette.primary.main }} />
                        )}
                      </Box>
                      <Typography variant="caption" noWrap sx={{ display: "block", color: "text.secondary" }}>
                        {prompt.content || "No content"}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <IconButton size="small" onClick={() => setEditingPrompt(prompt)}>
                        <Edit2 size={14} />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(prompt.id)} disabled={prompt.id === "default"}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tools Tab Component
// ---------------------------------------------------------------------------

function ToolsTab() {
  const muiTheme = useTheme();
  const tools = useToolStore((s) => s.tools);
  const isLoading = useToolStore((s) => s.isLoading);
  const { loadTools, toggleTool } = useToolStore((s) => s.actions);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const sourceColors: Record<string, string> = {
    builtin: muiTheme.palette.info.main,
    python: muiTheme.palette.success.main,
    mcp: muiTheme.palette.warning.main,
  };

  return (
    <Box sx={{ py: 2, display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: "14px", fontWeight: 500, color: "text.primary" }}>
            Available Tools
          </Typography>
          <Typography sx={{ fontSize: "13px", color: "text.secondary", mt: 0.5 }}>
            Tools are sent to the model so it can invoke them during conversations.
          </Typography>
        </Box>
        <Button
          variant="text"
          size="small"
          onClick={() => loadTools()}
          disabled={isLoading}
          sx={{
            textTransform: "none",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {isLoading ? "Loading..." : "Reload"}
        </Button>
      </Box>

      {tools.length === 0 && !isLoading && (
        <Typography sx={{ fontSize: "13px", color: "text.secondary", py: 4, textAlign: "center" }}>
          No tools registered. Tools will appear here once the backend is running.
        </Typography>
      )}

      {tools.map((tool: ToolDefinition) => (
        <Box
          key={tool.name}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            py: 1.5,
            px: 2,
            borderRadius: "8px",
            bgcolor: "action.hover",
            opacity: tool.enabled ? 1 : 0.6,
            transition: "opacity 0.2s ease",
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography
                sx={{
                  fontSize: "14px",
                  fontWeight: 600,
                  fontFamily: "monospace",
                  color: "text.primary",
                }}
              >
                {tool.name}
              </Typography>
              <Box
                sx={{
                  px: 1,
                  py: 0.1,
                  borderRadius: "4px",
                  bgcolor: sourceColors[tool.source] + "22",
                  border: `1px solid ${sourceColors[tool.source]}44`,
                }}
              >
                <Typography sx={{ fontSize: "10px", fontWeight: 600, color: sourceColors[tool.source], textTransform: "uppercase" }}>
                  {tool.source}
                </Typography>
              </Box>
              {tool.requiresApproval && (
                <Box
                  sx={{
                    px: 1,
                    py: 0.1,
                    borderRadius: "4px",
                    bgcolor: muiTheme.palette.warning.main + "22",
                    border: `1px solid ${muiTheme.palette.warning.main}44`,
                  }}
                >
                  <Typography sx={{ fontSize: "10px", fontWeight: 600, color: muiTheme.palette.warning.main }}>
                    APPROVAL
                  </Typography>
                </Box>
              )}
            </Box>
            <Typography
              sx={{
                fontSize: "12px",
                color: "text.secondary",
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tool.description}
            </Typography>
          </Box>
          <Button
            variant={tool.enabled ? "outlined" : "text"}
            size="small"
            onClick={() => toggleTool(tool.name)}
            sx={{
              textTransform: "none",
              fontSize: "12px",
              fontWeight: 500,
              minWidth: 70,
              ml: 2,
              borderColor: tool.enabled ? muiTheme.palette.divider : "transparent",
              color: tool.enabled ? "text.primary" : "text.secondary",
            }}
          >
            {tool.enabled ? "Enabled" : "Disabled"}
          </Button>
        </Box>
      ))}
    </Box>
  );
}
