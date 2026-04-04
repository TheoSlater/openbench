import * as React from "react";
import {
  Box,
  IconButton,
  Drawer,
  useMediaQuery,
  Theme,
  CSSObject,
  Typography,
} from "@mui/material";
import { PanelLeft, Plus, Settings, Trash2, Edit2, Check, X } from "lucide-react";
import { Conversation } from "@/store/chatStore";

interface SidebarContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(
  undefined,
);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery((theme: Theme) =>
    theme.breakpoints.down("md"),
  );
  const [openMobile, setOpenMobile] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  const value = React.useMemo(
    () => ({
      isOpen: !isCollapsed,
      setIsOpen: (open: boolean) => setIsCollapsed(!open),
      isCollapsed,
      setIsCollapsed,
      isMobile,
      openMobile,
      setOpenMobile,
    }),
    [isCollapsed, isMobile, openMobile],
  );

  return (
    <SidebarContext.Provider value={value}>
      <Box
        sx={{
          display: "flex",
          width: "100%",
          height: "100vh",
          overflow: "hidden",
          bgcolor: "#0d0d0d",
        }}
      >
        {children}
      </Box>
    </SidebarContext.Provider>
  );
}

interface SidebarProps {
  onOpenSettings: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => Promise<void>;
  conversations: Conversation[];
  activeConversationId: string | null;
  collapsible?: "icon" | "none";
}

export function Sidebar({
  onOpenSettings,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  conversations,
  activeConversationId,
  collapsible,
}: SidebarProps) {
  const { isCollapsed, isMobile, openMobile, setOpenMobile } = useSidebar();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");

  const handleStartRename = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(conv.title || "Untitled");
  };

  const handleConfirmRename = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (editValue.trim()) {
      await onRenameConversation(id, editValue.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const sidebarContent = (
    <>
      <SidebarHeader>
        <SidebarMenuButton onClick={onNewChat} isActive={false}>
          <Plus size={18} />
          {!isCollapsed && <Box component="span" sx={{ ml: 1 }}>New Chat</Box>}
        </SidebarMenuButton>
      </SidebarHeader>

      <SidebarContent>
        {!isCollapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {conversations.map((conv) => (
                  <SidebarMenuButton
                    key={conv.id}
                    isActive={activeConversationId === conv.id}
                    onClick={() => {
                      onSelectConversation(conv.id);
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", width: "100%", minWidth: 0 }}>
                      {editingId === conv.id ? (
                        <Box sx={{ display: "flex", alignItems: "center", width: "100%", gap: 0.5 }}>
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleConfirmRename(e as any, conv.id);
                              if (e.key === "Escape") handleCancelRename(e as any);
                            }}
                            style={{
                              flex: 1,
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              outline: "none",
                              fontSize: "inherit",
                              padding: 0,
                            }}
                          />
                          <IconButton size="small" onClick={(e) => handleConfirmRename(e, conv.id)} sx={{ p: 0.5, color: "rgba(255,255,255,0.6)" }}>
                            <Check size={14} />
                          </IconButton>
                          <IconButton size="small" onClick={handleCancelRename} sx={{ p: 0.5, color: "rgba(255,255,255,0.6)" }}>
                            <X size={14} />
                          </IconButton>
                        </Box>
                      ) : (
                        <>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ flex: 1, color: activeConversationId === conv.id ? "#fff" : "inherit" }}
                          >
                            {conv.title || "Untitled"}
                          </Typography>
                          {!isCollapsed && activeConversationId === conv.id && (
                            <Box sx={{ display: "flex", gap: 0.5 }}>
                              <IconButton
                                size="small"
                                onClick={(e) => handleStartRename(e, conv)}
                                sx={{ p: 0.5, color: "rgba(255,255,255,0.4)", "&:hover": { color: "#fff" } }}
                              >
                                <Edit2 size={14} />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conv.id);
                                }}
                                sx={{ p: 0.5, color: "rgba(255,255,255,0.4)", "&:hover": { color: "#f44336" } }}
                              >
                                <Trash2 size={14} />
                              </IconButton>
                            </Box>
                          )}
                        </>
                      )}
                    </Box>
                  </SidebarMenuButton>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenuButton onClick={onOpenSettings} isActive={false}>
          <Settings size={18} />
          {!isCollapsed && <Box component="span" sx={{ ml: 1 }}>Settings</Box>}
        </SidebarMenuButton>
      </SidebarFooter>
    </>
  );

  if (isMobile) {
    return (
      <Drawer
        open={openMobile}
        onClose={() => setOpenMobile(false)}
        PaperProps={{
          sx: {
            width: 260,
            bgcolor: "#0d0d0d",
            borderRight: "1px solid rgba(255, 255, 255, 0.05)",
            backgroundImage: "none",
          },
        }}
      >
        {sidebarContent}
      </Drawer>
    );
  }

  const width = isCollapsed && collapsible === "icon" ? 60 : 260;

  return (
    <Box
      sx={{
        width,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "#0d0d0d",
        borderRight: "1px solid rgba(255, 255, 255, 0.05)",
        transition: "width 0.2s ease-in-out",
        overflowX: "hidden",
      }}
    >
      {sidebarContent}
    </Box>
  );
}

export function SidebarHeader({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: CSSObject;
}) {
  const { isCollapsed } = useSidebar();
  return (
    <Box
      sx={{
        p: 0,
        px: isCollapsed ? 0 : 2,
        display: "flex",
        alignItems: "center",
        justifyContent: isCollapsed ? "center" : "space-between",
        minHeight: 56,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarContent({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarFooter({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: CSSObject;
}) {
  const { isCollapsed } = useSidebar();
  return (
    <Box
      sx={{
        p: 1.5,
        px: isCollapsed ? 0 : 1.5,
        display: "flex",
        alignItems: "center",
        justifyContent: isCollapsed ? "center" : "flex-start",
        borderTop: "1px solid rgba(255, 255, 255, 0.05)",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarGroup({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: CSSObject;
}) {
  return <Box sx={{ mb: 2, width: "100%", ...sx }}>{children}</Box>;
}

export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, mb: 1, mt: 2 }}>
      <Box
        component="span"
        sx={{
          fontSize: "11px",
          fontWeight: 600,
          color: "rgba(255, 255, 255, 0.3)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function SidebarGroupContent({
  children,
  sx,
}: {
  children: React.ReactNode;
  sx?: CSSObject;
}) {
  const { isCollapsed } = useSidebar();
  return (
    <Box sx={{ px: isCollapsed ? 0 : 0, width: "100%", ...sx }}>{children}</Box>
  );
}

export function SidebarMenu({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        px: isCollapsed ? 0 : 1.5,
        alignItems: isCollapsed ? "center" : "stretch",
        width: "100%",
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarMenuButton({
  children,
  isActive,
  onClick,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
}) {
  const { isCollapsed } = useSidebar();
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: isCollapsed ? "center" : "flex-start",
        gap: isCollapsed ? 0 : 2,
        px: isCollapsed ? 0 : 1.5,
        width: isCollapsed ? 36 : "100%",
        height: 36,
        borderRadius: "8px",
        cursor: "pointer",
        transition: "all 0.2s",
        bgcolor: isActive ? "rgba(255, 255, 255, 0.05)" : "transparent",
        color: isActive ? "#fff" : "rgba(255, 255, 255, 0.6)",
        fontSize: "13px",
        fontWeight: 500,
        overflow: "hidden",
        "&:hover": {
          bgcolor: "rgba(255, 255, 255, 0.05)",
          color: "#fff",
        },
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarTrigger({ sx }: { sx?: CSSObject }) {
  const { isCollapsed, setIsCollapsed, isMobile, setOpenMobile } = useSidebar();

  const handleClick = () => {
    if (isMobile) {
      setOpenMobile(true);
    } else {
      setIsCollapsed(!isCollapsed);
    }
  };

  return (
    <IconButton
      onClick={handleClick}
      size="small"
      sx={{
        color: "rgba(255, 255, 255, 0.4)",
        "&:hover": { color: "#fff", bgcolor: "rgba(255, 255, 255, 0.05)" },
        ...sx,
      }}
    >
      <PanelLeft size={18} />
    </IconButton>
  );
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {children}
    </Box>
  );
}
