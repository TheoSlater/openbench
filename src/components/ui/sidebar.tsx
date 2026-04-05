import * as React from "react";
import {
  Box,
  IconButton,
  Drawer,
  useMediaQuery,
  Theme,
  CSSObject,
} from "@mui/material";
import { PanelLeft } from "lucide-react";

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

export function Sidebar({
  children,
  collapsible,
}: {
  children: React.ReactNode;
  collapsible?: "icon" | "none";
}) {
  const { isCollapsed, isMobile, openMobile, setOpenMobile } = useSidebar();

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
        {children}
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
        overflowX: "hidden", // Fixes horizontal scroll
      }}
    >
      {children}
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
        overflowX: "hidden", // Prevent horizontal scroll in content
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
        bgcolor: isActive ? "action.hover" : "transparent",
        color: isActive ? "text.primary" : "text.secondary",
        fontSize: "13px",
        fontWeight: 500,
        overflow: "hidden",
        "&:hover": {
          bgcolor: "action.hover",
          color: "text.primary",
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
        color: "text.secondary",
        "&:hover": { color: "text.primary", bgcolor: "action.hover" },
        ...sx,
      }}
    >
      <PanelLeft size={18} />
    </IconButton>
  );
}
