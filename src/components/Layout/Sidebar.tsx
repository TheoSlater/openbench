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
import {
  PanelLeft,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  MoreHorizontal,
  Archive,
} from "lucide-react";
import { Conversation, useChatStore } from "@/store/chatStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteConversationDialog } from "@/components/Chat/DeleteConversationDialog";
import { ProfileMenu } from "@/components/Profile/ProfileMenu";

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
          bgcolor: "background.default",
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
  const { actions: chatActions } = useChatStore();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleteTitle, setDeleteTitle] = React.useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);

  const handleStartDelete = (conv: Conversation) => {
    setDeleteId(conv.id);
    setDeleteTitle(conv.title || "Untitled");
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteId) {
      onDeleteConversation(deleteId);
      setDeleteId(null);
      setDeleteTitle("");
    }
  };

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

  const handleArchive = async (id: string) => {
    await chatActions.archiveConversation(id);
  };

  const sidebarContent = (
    <>
      <SidebarHeader>
        {!isCollapsed ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", px: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: "primary.main",
                letterSpacing: "0.01em",
                opacity: 1,
              }}
            >
              OpenBench
            </Typography>
            <SidebarTrigger />
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", pt: 2, gap: 2 }}>
            <SidebarTrigger />
            <IconButton
              onClick={onNewChat}
              size="small"
              sx={{
                color: "text.secondary",
                "&:hover": { color: "text.primary", bgcolor: "action.hover" },
              }}
            >
              <Plus size={18} />
            </IconButton>
          </Box>
        )}
      </SidebarHeader>

      <SidebarContent>
        {!isCollapsed && (
          <Box sx={{ px: 1.5, mb: 2, mt: 1, display: "flex", justifyContent: "center" }}>
            <SidebarMenuButton
              onClick={onNewChat}
              isActive={false}
              sx={{
                width: "100%",
                justifyContent: "flex-start",
                bgcolor: "transparent",
                border: "1px solid",
                borderColor: "divider",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Plus size={18} />
              <Box component="span" sx={{ ml: 1 }}>
                New Chat
              </Box>
            </SidebarMenuButton>
          </Box>
        )}

        {!isCollapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {conversations.filter(c => !c.isArchived).map((conv) => (
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
                          <IconButton size="small" onClick={(e) => handleConfirmRename(e, conv.id)} sx={{ p: 0.5, color: "text.secondary" }}>
                            <Check size={14} />
                          </IconButton>
                          <IconButton size="small" onClick={handleCancelRename} sx={{ p: 0.5, color: "text.secondary" }}>
                            <X size={14} />
                          </IconButton>
                        </Box>
                      ) : (
                        <>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{
                              flex: 1,
                              color:
                                activeConversationId === conv.id
                                  ? "text.primary"
                                  : "inherit",
                            }}
                          >
                            {conv.title || "Untitled"}
                          </Typography>
                          {!isCollapsed && (
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <IconButton
                                  size="small"
                                  onClick={(e) => e.stopPropagation()}
                                  sx={{
                                    p: 0.5,
                                    color: "text.secondary",
                                    "&:hover": {
                                      color: "text.primary",
                                      bgcolor: "action.selected",
                                    },
                                    opacity:
                                      activeConversationId === conv.id ? 1 : 0,
                                    ".MuiBox-root:hover &": { opacity: 1 },
                                  }}
                                >
                                  <MoreHorizontal size={14} />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleStartRename({ stopPropagation: () => {} } as any, conv)}
                                >
                                  <Edit2 size={14} />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleArchive(conv.id)}
                                >
                                  <Archive size={14} />
                                  Archive
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => handleStartDelete(conv)}
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

      <SidebarFooter sx={{ flexDirection: "column", gap: 1, p: 1.5 }}>
        <ProfileMenu onOpenSettings={onOpenSettings} />
      </SidebarFooter>

      <DeleteConversationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title={deleteTitle}
      />
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
            bgcolor: "background.sidebar",
            borderRight: "1px solid",
            borderColor: "divider",
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
        bgcolor: "background.sidebar",
        borderRight: "1px solid",
        borderColor: "divider",
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
        display: "flex",
        alignItems: "center",
        justifyContent: isCollapsed ? "center" : "flex-start",
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
        borderTop: "1px solid",
        borderColor: "divider",
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
          color: "text.secondary",
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
  sx,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  sx?: CSSObject;
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
        bgcolor: isActive ? "action.hover" : "transparent",
        color: isActive ? "text.primary" : "text.secondary",
        fontSize: "13px",
        fontWeight: 500,
        overflow: "hidden",
        "&:hover": {
          bgcolor: "action.hover",
          color: "text.primary",
        },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function SidebarTrigger({ sx }: { sx?: CSSObject }) {
  const { isCollapsed, setIsCollapsed, isMobile, setOpenMobile } = useSidebar();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
        color: "text.secondary",
        "&:hover": { color: "text.primary", bgcolor: "action.hover" },
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
