import { PersonalizationPanel } from "./PersonalizationPanel";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import {
  Settings,
  UserCircle,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { Box, Typography } from "@mui/material";
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

/**
 * Settings modal overlay with ChatGPT-style sidebar navigation.
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const personalizationRef = useRef<PersonalizationPanelRef>(null);
  const [activeTab, setActiveTab] = useState("general");
  const { mode, setMode } = useThemeStore();

  const handleSave = () => {
    if (activeTab === "personalization") {
      if (personalizationRef.current?.handleSave()) {
        onClose();
      }
    } else {
      // For general tab (theme), it's already updated, just close
      onClose();
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      maxWidth={1024}
      contentSx={{ p: 0 }}
    >
      <Box sx={{ display: "flex", flexDirection: "row", height: "85vh", width: { xs: "95vw", md: "100%" }, overflow: "hidden" }}>

          {/* Left Sidebar */}
          <Box
            component="aside"
            sx={{
              display: { xs: "none", md: "flex" },
              width: 256,
              flexShrink: 0,
              flexDirection: "column",
              borderRight: "1px solid",
              borderColor: "divider",
              bgcolor: "background.sidebar",
              px: 1.5,
              py: 3,
              overflowY: "auto",
            }}
          >
            <Box component="nav" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {SIDEBAR_ITEMS.map((item) => (
                <Box
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    width: "100%",
                    borderRadius: "12px",
                    px: 1.5,
                    py: 1.25,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    bgcolor: activeTab === item.id ? "action.hover" : "transparent",
                    color: activeTab === item.id ? "text.primary" : "text.secondary",
                    "&:hover": {
                      bgcolor: "action.hover",
                      color: "text.primary",
                    },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <item.icon size={16} />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Main Content Area */}
          <Box sx={{ display: "flex", height: "100%", minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden", bgcolor: "background.default" }}>
            <Box
              component="header"
              sx={{
                display: "flex",
                flexShrink: 0,
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: { xs: 2, sm: 3 },
                borderBottom: "1px solid",
                borderColor: "divider",
                px: { xs: 3, sm: 5 },
                py: { xs: 2, sm: 3 },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1, pr: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, color: "text.primary", fontSize: { xs: "1.125rem", sm: "1.5rem" } }}>
                  {SIDEBAR_ITEMS.find((i) => i.id === activeTab)?.label}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
                  Manage your {activeTab} preferences and configuration.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  sx={{ borderRadius: "12px", px: 3 }}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSave}
                  sx={{ borderRadius: "12px", px: 4, bgcolor: "primary.main", color: "primary.contrastText", fontWeight: 700, "&:hover": { opacity: 0.9 } }}
                >
                  Save
                </Button>
              </Box>
            </Box>

            <Box component="main" sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 3, sm: 5 }, py: { xs: 4, sm: 5 } }}>
              {activeTab === "personalization" ? (
                <PersonalizationPanel ref={personalizationRef} />
              ) : activeTab === "general" ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5, color: "text.primary" }}>
                      Theme
                    </Typography>
                    <Box sx={{ display: "flex", gap: 2 }}>
                      {[
                        { id: "light", label: "Light", icon: Sun },
                        { id: "dark", label: "Dark", icon: Moon },
                        { id: "system", label: "System", icon: Monitor },
                      ].map((t) => (
                        <Box
                          key={t.id}
                          onClick={() => setMode(t.id as ThemeMode)}
                          sx={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                            p: 2,
                            borderRadius: "12px",
                            border: "1px solid",
                            borderColor: mode === t.id ? "primary.main" : "divider",
                            bgcolor: mode === t.id ? "action.selected" : "transparent",
                            cursor: "pointer",
                            transition: "all 0.2s",
                            "&:hover": {
                              bgcolor: "action.hover",
                            },
                          }}
                        >
                          <t.icon size={20} color={mode === t.id ? "var(--mui-palette-primary-main)" : "var(--mui-palette-text-secondary)"} />
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: mode === t.id ? 600 : 500,
                              color: mode === t.id ? "text.primary" : "text.secondary",
                            }}
                          >
                            {t.label}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: "flex", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <Box sx={{ borderRadius: "50%", bgcolor: "action.hover", p: 2.5 }}>
                    <Settings size={40} style={{ color: "var(--mui-palette-divider)" }} />
                  </Box>
                  <Typography variant="subtitle1" sx={{ mt: 2.5, fontWeight: 700, color: "text.primary" }}>
                    Section under development
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
                    This part of the settings is coming soon.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Modal>
    );
  }
