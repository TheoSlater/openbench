import { PersonalizationPanel } from "./PersonalizationPanel";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { Settings, UserCircle, Sun, Moon, Monitor } from "lucide-react";
import { Box, Typography, useTheme } from "@mui/material";
import { useThemeStore, ThemeMode } from "@/store/themeStore";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export interface PersonalizationPanelRef {
  handleSave: () => boolean;
  handleSaveAsNew: () => boolean;
}

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
  const personalizationRef = useRef<PersonalizationPanelRef>(null);
  const [activeTab, setActiveTab] = useState("general");
  const { mode, setMode } = useThemeStore();

  const handleSave = () => {
    if (activeTab === "personalization") {
      if (personalizationRef.current?.handleSave()) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      maxWidth="lg"
      contentSx={{ p: 0, overflow: "hidden" }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          height: "90vh",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {/* Left Sidebar */}
        <Box
          component="aside"
          sx={{
            display: { xs: "none", md: "flex" },
            width: 256,
            flexShrink: 0,
            flexDirection: "column",
            borderRight: `1px solid ${muiTheme.palette.divider}`,
            bgcolor: muiTheme.palette.background.paper,
            px: 1.5,
            py: 3,
          }}
        >
          <Box
            component="nav"
            sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
          >
            {SIDEBAR_ITEMS.map((item) => (
              <Box
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                component="button"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  width: "100%",
                  border: "none",
                  borderRadius: "12px",
                  px: 1.5,
                  py: 1.25,
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
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <item.icon size={18} />
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
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
            overflow: "hidden",
          }}
        >
          {/* Content */}
          <Box
            component="main"
            sx={{
              minHeight: 0,
              flex: 1,
              px: { xs: 3, sm: 5 },
              py: { xs: 4, sm: 5 },
              overflowY: "auto",
            }}
          >
            {activeTab === "personalization" ? (
              <PersonalizationPanel ref={personalizationRef} />
            ) : activeTab === "general" ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Theme Section */}
                <Box>
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 600, mb: 2 }}
                  >
                    Theme
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      gap: 2,
                      flexWrap: { xs: "wrap", sm: "nowrap" },
                    }}
                  >
                    {THEME_OPTIONS.map((themeOption) => {
                      const isSelected = mode === themeOption.id;
                      return (
                        <Box
                          key={themeOption.id}
                          component="button"
                          onClick={() => setMode(themeOption.id as ThemeMode)}
                          sx={{
                            flex: { xs: "1 1 calc(33.333% - 8px)", sm: 1 },
                            minWidth: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1.5,
                            p: 2.5,
                            borderRadius: "12px",
                            border: `2px solid ${isSelected ? muiTheme.palette.primary.main : muiTheme.palette.divider}`,
                            background: isSelected
                              ? muiTheme.palette.action.selected
                              : muiTheme.palette.background.paper,
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            "&:hover": {
                              borderColor: muiTheme.palette.primary.main,
                              background: isSelected
                                ? muiTheme.palette.action.selected
                                : muiTheme.palette.action.hover,
                            },
                            "&:active": {
                              transform: "scale(0.98)",
                            },
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 40,
                              height: 40,
                              borderRadius: "8px",
                              background: isSelected
                                ? muiTheme.palette.primary.main
                                : muiTheme.palette.action.hover,
                              color: isSelected
                                ? muiTheme.palette.primary.contrastText
                                : muiTheme.palette.text.secondary,
                              transition: "all 0.2s ease",
                            }}
                          >
                            <themeOption.icon size={20} />
                          </Box>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: isSelected ? 600 : 500,
                              color: isSelected
                                ? muiTheme.palette.text.primary
                                : muiTheme.palette.text.secondary,
                            }}
                          >
                            {themeOption.label}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 2,
                }}
              >
                <Box
                  sx={{
                    borderRadius: "50%",
                    bgcolor: muiTheme.palette.action.hover,
                    p: 3,
                  }}
                >
                  <Settings size={40} color={muiTheme.palette.text.disabled} />
                </Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Section under development
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: muiTheme.palette.text.secondary }}
                >
                  This part of the settings is coming soon.
                </Typography>
              </Box>
            )}
          </Box>

          {/* Footer */}
          <Box
            component="footer"
            sx={{
              flexShrink: 0,
              display: "flex",
              justifyContent: "flex-end",
              gap: 1.5,
              borderTop: `1px solid ${muiTheme.palette.divider}`,
              px: { xs: 3, sm: 5 },
              py: { xs: 2, sm: 3 },
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              sx={{ borderRadius: "12px", px: 3 }}
            >
              Cancel
            </Button>
            <Button variant="default" size="sm" onClick={handleSave}>
              Save
            </Button>
          </Box>
        </Box>
      </Box>
    </Modal>
  );
}
