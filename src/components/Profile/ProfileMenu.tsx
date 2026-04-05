import React from "react";
import { useAuthStore } from "@/store/authStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Box, Typography, Button as MuiButton } from "@mui/material";
import { Settings, Archive, Layout, Shield, LogOut } from "lucide-react";

import { useSidebar } from "@/components/Layout/Sidebar";
import { ArchivedChatsDialog } from "@/components/Chat/ArchivedChatsDialog";

interface ProfileMenuProps {
  onOpenSettings?: () => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ onOpenSettings }) => {
  const { user, actions, isLoading } = useAuthStore();
  const { isCollapsed } = useSidebar();
  const [isArchivedOpen, setIsArchivedOpen] = React.useState(false);

  if (isLoading) {
    return (
      <Box className="w-full flex flex-col items-center" sx={{ opacity: 0.5 }}>
        <MuiButton
          fullWidth
          disabled
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 1.5,
            p: 1,
            borderRadius: 2,
            textTransform: "none",
          }}
        >
          <Box sx={{ width: 36, height: 36, borderRadius: "50%", bgcolor: "action.selected" }} />
          {!isCollapsed && (
            <Box>
              <Box sx={{ width: 80, height: 14, bgcolor: "action.selected", mb: 0.5, borderRadius: 1 }} />
              <Box sx={{ width: 40, height: 10, bgcolor: "action.selected", borderRadius: 1 }} />
            </Box>
          )}
        </MuiButton>
      </Box>
    );
  }

  if (!user) return null;

  const initials = user.fullName
    ? user.fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : user.email[0].toUpperCase();

  return (
    <Box className="w-full flex flex-col items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <MuiButton
            fullWidth
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 1.5,
              p: 1,
              borderRadius: 2,
              textTransform: "none",
              color: "text.primary",
              textAlign: "left",
              "&:hover": {
                bgcolor: "action.hover",
              },
            }}
          >
            <Box className="relative flex-shrink-0" sx={{ display: "flex" }}>
              <Avatar sx={{ width: 36, height: 36 }}>
                {user.avatarUrl && (
                  <AvatarImage
                    src={user.avatarUrl}
                    alt={user.fullName || user.email}
                  />
                )}
                <AvatarFallback
                  sx={{
                    bgcolor: "action.selected",
                    color: "text.primary",
                    fontSize: "0.75rem",
                  }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
              <Box
                sx={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 12,
                  height: 12,
                  bgcolor: "success.main",
                  border: "2px solid",
                  borderColor: "background.default",
                  borderRadius: "50%",
                }}
              />
            </Box>
            {!isCollapsed && (
              <Box className="flex-1 overflow-hidden">
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 500 }}
                  className="truncate"
                >
                  {user.fullName || "User"}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  className="truncate"
                >
                  {user.status}
                </Typography>
              </Box>
            )}
          </MuiButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography
                variant="body2"
                sx={{ fontWeight: 500, lineHeight: 1.2 }}
              >
                {user.fullName || "User"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.2 }}
              >
                {user.email}
              </Typography>
            </Box>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer" onClick={onOpenSettings}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setIsArchivedOpen(true)}
          >
            <Archive className="mr-2 h-4 w-4" />
            <span>Archived Chats</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer">
            <Layout className="mr-2 h-4 w-4" />
            <span>Playground</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer">
            <Shield className="mr-2 h-4 w-4" />
            <span>Admin Panel</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer"
            sx={{ color: "error.main", "&:focus": { color: "error.main" } }}
            onClick={() => actions.logout()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign Out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ArchivedChatsDialog
        open={isArchivedOpen}
        onOpenChange={setIsArchivedOpen}
      />
    </Box>
  );
};
