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
  Search,
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
import { isToday, isYesterday, subDays, isAfter } from "date-fns";
import { InputBase } from "@mui/material";

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
  onNewChat: (isTemporary?: boolean) => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => Promise<void>;
  conversations: Conversation[];
  activeConversationId: string | null;
  collapsible?: "icon" | "none";
}

function ConversationItem({
  conv,
  activeConversationId,
  editingId,
  editValue,
  setEditValue,
  handleConfirmRename,
  handleCancelRename,
  handleStartRename,
  handleArchive,
  handleStartDelete,
}: {
  conv: Conversation;
  activeConversationId: string | null;
  editingId: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  handleConfirmRename: (e: React.MouseEvent, id: string) => void;
  handleCancelRename: (e: React.MouseEvent) => void;
  handleStartRename: (e: React.MouseEvent, conv: Conversation) => void;
  handleArchive: (id: string) => void;
  handleStartDelete: (conv: Conversation) => void;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        minWidth: 0,
      }}
    >
      {editingId === conv.id ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            gap: 0.5,
          }}
        >
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
          <IconButton
            size="small"
            onClick={(e) => handleConfirmRename(e, conv.id)}
            sx={{ p: 0.5, color: "text.secondary" }}
          >
            <Check size={14} />
          </IconButton>
          <IconButton
            size="small"
            onClick={handleCancelRename}
            sx={{ p: 0.5, color: "text.secondary" }}
          >
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
                activeConversationId === conv.id ? "text.primary" : "inherit",
            }}
          >
            {conv.title || "Untitled"}
          </Typography>
          <Box
            className="conversation-actions"
            sx={{
              display: "flex",
              gap: 0,
              opacity: 0,
              transition: "opacity 0.2s",
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
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
                  }}
                >
                  <MoreHorizontal size={14} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => handleStartRename(e, conv)}>
                  <Edit2 size={14} /> Rename
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => handleArchive(conv.id)}>
                  <Archive size={14} /> Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => handleStartDelete(conv)}
                >
                  <Trash2 size={14} /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Box>
        </>
      )}
    </Box>
  );
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
  const archiveConversation = useChatStore((state) => state.actions.archiveConversation);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleteTitle, setDeleteTitle] = React.useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");

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
    e.preventDefault();
    setEditingId(conv.id);
    setEditValue(conv.title || "Untitled");
  };

  const handleConfirmRename = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (editValue.trim()) {
      await onRenameConversation(id, editValue.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(null);
  };

  const handleArchive = async (id: string) => {
    await archiveConversation(id);
  };

  const groupedConversations = React.useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);
    const query = searchQuery.toLowerCase().trim();

    const filtered = conversations
      .filter((c) => !c.isArchived && !c.isTemporary)
      .filter((c) => {
        if (!query) return true;
        return (c.title || "Untitled").toLowerCase().includes(query);
      });

    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const last7Days: Conversation[] = [];
    const older: Conversation[] = [];

    filtered.forEach((conv) => {
      const date = new Date(conv.updatedAt || conv.createdAt);
      if (isToday(date)) {
        today.push(conv);
      } else if (isYesterday(date)) {
        yesterday.push(conv);
      } else if (isAfter(date, sevenDaysAgo)) {
        last7Days.push(conv);
      } else {
        older.push(conv);
      }
    });

    return [
      { id: "today", label: "Today", items: today },
      { id: "yesterday", label: "Yesterday", items: yesterday },
      { id: "last7days", label: "Previous 7 Days", items: last7Days },
      { id: "older", label: "Older", items: older },
    ].filter((group) => group.items.length > 0);
  }, [conversations, searchQuery]);

  const sidebarContent = (
    <>
      <SidebarHeader>
        {!isCollapsed ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              px: 2,
            }}
          >
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
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              pt: 2,
              gap: 2,
            }}
          >
            <SidebarTrigger />
            <IconButton
              onClick={() => onNewChat(false)}
              size="small"
              sx={{
                color: "text.secondary",
                "&:hover": { color: "text.primary", bgcolor: "action.hover" },
              }}
            >
              <Plus size={18} />
            </IconButton>
            <IconButton
              onClick={() => onNewChat(true)}
              size="small"
              sx={{
                color: "text.secondary",
                "&:hover": { color: "text.primary", bgcolor: "action.hover" },
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
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2.5 3.5"
                ></path>
              </svg>
            </IconButton>
          </Box>
        )}
      </SidebarHeader>

      <SidebarContent>
        {!isCollapsed && (
          <Box sx={{ px: 1.5, mb: 1.5, mt: 0.5 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                height: 36,
                borderRadius: "10px",
                bgcolor: "action.hover",
                color: "text.secondary",
                border: "1px solid",
                borderColor: "transparent",
                transition: "all 0.2s",
                "&:focus-within": {
                  borderColor: "primary.main",
                  bgcolor: "background.paper",
                  boxShadow: "0 0 0 2px rgba(var(--primary-rgb), 0.1)",
                },
              }}
            >
              <Search size={14} />
              <InputBase
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{
                  flex: 1,
                  fontSize: "13px",
                  color: "text.primary",
                  "& .MuiInputBase-input::placeholder": {
                    color: "text.secondary",
                    opacity: 0.7,
                  },
                }}
              />
              {searchQuery && (
                <IconButton
                  size="small"
                  onClick={() => setSearchQuery("")}
                  sx={{
                    p: 0.5,
                    color: "text.secondary",
                    "&:hover": { color: "text.primary" },
                  }}
                >
                  <X size={12} />
                </IconButton>
              )}
            </Box>
          </Box>
        )}

        {!isCollapsed && (
          <Box
            sx={{
              px: 1.5,
              mb: 1,
              mt: 1,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <SidebarMenuButton
              onClick={() => onNewChat(false)}
              isActive={false}
              sx={{
                width: "100%",
                justifyContent: "flex-start",
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "12px",
                py: 2.5,
                px: 2,
                "&:hover": {
                  bgcolor: "action.hover",
                  borderColor: "border.main",
                },
              }}
            >
              <Plus size={18} />
              <Box component="span" sx={{ ml: 1, fontWeight: 500 }}>
                New Chat
              </Box>
            </SidebarMenuButton>
            <SidebarMenuButton
              onClick={() => onNewChat(true)}
              isActive={false}
              sx={{
                width: "100%",
                justifyContent: "flex-start",
                bgcolor: "transparent",
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: "12px",
                py: 2.5,
                px: 2,
                "&:hover": {
                  bgcolor: "action.hover",
                  borderColor: "border.main",
                },
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
                <path
                  d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2.5 3.5"
                ></path>
              </svg>
              <Box component="span" sx={{ ml: 1, fontWeight: 500 }}>
                Temporary Chat
              </Box>
            </SidebarMenuButton>
          </Box>
        )}

        {!isCollapsed && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {groupedConversations.map((group) => (
              <SidebarGroup key={group.id} sx={{ mb: 0 }}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent sx={{ mt: 0.75 }}>
                  <SidebarMenu>
                    {group.items.map((conv) => (
                      <SidebarMenuButton
                        key={conv.id}
                        isActive={activeConversationId === conv.id}
                        onClick={() => {
                          onSelectConversation(conv.id);
                          if (isMobile) setOpenMobile(false);
                        }}
                        sx={{
                          py: 1,
                          px: 2.5,
                          mx: 0,
                          width: "100%",
                          borderRadius: "12px",
                          "&:hover .conversation-actions": { opacity: 1 },
                        }}
                      >
                        <ConversationItem
                          conv={conv}
                          activeConversationId={activeConversationId}
                          editingId={editingId}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          handleConfirmRename={handleConfirmRename}
                          handleCancelRename={handleCancelRename}
                          handleStartRename={handleStartRename}
                          handleArchive={handleArchive}
                          handleStartDelete={handleStartDelete}
                        />
                      </SidebarMenuButton>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </Box>
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
        backgroundImage: "none",
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
    <Box sx={{ px: 2.5, mb: 0, mt: 0 }}>
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

export function SidebarMenu({
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
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        px: isCollapsed ? 0 : 1.5,
        alignItems: isCollapsed ? "center" : "stretch",
        width: "100%",
        ...sx,
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
