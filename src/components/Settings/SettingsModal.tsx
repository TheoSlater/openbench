import { PersonalizationPanel } from "./PersonalizationPanel";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import {
  Settings,
  UserCircle,
  X,
} from "lucide-react";
import { Box, Typography, IconButton } from "@mui/material";

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
  const [activeTab, setActiveTab] = useState("personalization");

  const handleSave = () => {
    if (personalizationRef.current?.handleSave()) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        showCloseButton={false}
      >
        <Box sx={{ display: "flex", flexDirection: "row", height: "85vh", width: "95vw", maxWidth: 1024, overflow: "hidden" }}>
          {/* Custom Close Button Top Left (Header) - ALWAYS VISIBLE */}
          <Box sx={{ position: "absolute", top: 16, left: 16, zIndex: 50 }}>
            <DialogClose render={<IconButton size="small" sx={{ bgcolor: "rgba(255,255,255,0.05)", "&:hover": { bgcolor: "rgba(255,255,255,0.1)" } }} />}>
              <X size={20} />
            </DialogClose>
          </Box>

          {/* Left Sidebar */}
          <Box
            component="aside"
            sx={{
              display: { xs: "none", md: "flex" },
              width: 256,
              flexShrink: 0,
              flexDirection: "column",
              borderRight: "1px solid",
              borderColor: "rgba(255, 255, 255, 0.05)",
              bgcolor: "rgba(255, 255, 255, 0.02)",
              px: 1.5,
              pt: 8, // Make room for close button
              pb: 3,
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
                    bgcolor: activeTab === item.id ? "rgba(255, 255, 255, 0.05)" : "transparent",
                    color: activeTab === item.id ? "#fff" : "rgba(255, 255, 255, 0.6)",
                    "&:hover": {
                      bgcolor: "rgba(255, 255, 255, 0.05)",
                      color: "#fff",
                    },
                  }}
                >
                  <item.icon size={16} />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{item.label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Main Content Area */}
          <Box sx={{ display: "flex", height: "100%", minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden", bgcolor: "background.default", maxWidth: { md: "calc(1024px - 256px)" } }}>
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
                borderColor: "rgba(255, 255, 255, 0.05)",
                px: { xs: 3, sm: 5 },
                pt: { xs: 8, md: 3 }, // More padding on mobile for close button
                pb: { xs: 2, sm: 3 },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <DialogTitle>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: "#fff", fontSize: { xs: "1.125rem", sm: "1.5rem" } }}>
                    {SIDEBAR_ITEMS.find((i) => i.id === activeTab)?.label}
                  </Typography>
                </DialogTitle>
                <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.4)", fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
                  Manage your {activeTab} preferences and configuration.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", width: "100%", shrink: 0, alignItems: "center", justifyContent: "flex-end", gap: 1.5, sm: { width: "auto" } }}>
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
                  sx={{ borderRadius: "12px", px: 4, bgcolor: "#fff", color: "#000", fontWeight: 700, "&:hover": { bgcolor: "rgba(255, 255, 255, 0.9)" } }}
                >
                  Save
                </Button>
              </Box>
            </Box>

            <Box component="main" sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: { xs: 3, sm: 5 }, py: { xs: 4, sm: 5 } }}>
              {activeTab === "personalization" ? (
                <PersonalizationPanel ref={personalizationRef} />
              ) : (
                <Box sx={{ display: "flex", height: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <Box sx={{ borderRadius: "50%", bgcolor: "rgba(255, 255, 255, 0.02)", p: 2.5 }}>
                    <Settings size={40} style={{ color: "rgba(255, 255, 255, 0.1)" }} />
                  </Box>
                  <Typography variant="subtitle1" sx={{ mt: 2.5, fontWeight: 700, color: "#fff" }}>
                    Section under development
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, color: "rgba(255, 255, 255, 0.3)" }}>
                    This part of the settings is coming soon.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
