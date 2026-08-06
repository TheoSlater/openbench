import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/store/authStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { Button as Button } from "@/components/ui/button";
import { Settings, Archive, LogOut, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";

import { useSidebar } from "@/components/ui/sidebar";
import { ArchivedChatsDialog } from "@/features/chat/components/ArchivedChatsDialog";
import type { SettingsTab } from "@/features/settings/SettingsModal";

interface ProfileMenuProps {
  onOpenSettings?: (tab?: SettingsTab) => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({
  onOpenSettings,
}) => {
  const { user, isGuest, actions, isLoading } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      isGuest: state.isGuest,
      actions: state.actions,
      isLoading: state.isLoading,
    })),
  );
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isArchivedOpen, setIsArchivedOpen] = React.useState(false);

  if (isLoading) {
    return (
      <Box className="px-1.5 pb-0.5">
        <Button
          type="button"
          variant="ghost"
          fullWidth
          disabled
          className={cn(
            "h-auto min-w-0 justify-start gap-2 rounded-lg px-2 py-1.5",
            isCollapsed && "justify-center px-0",
          )}
        >
          <Box className="size-7 shrink-0 rounded-full bg-muted" />
          {!isCollapsed && (
            <Box className="flex min-w-0 flex-1 flex-col gap-1">
              <Box className="h-2.5 w-20 rounded-full bg-muted" />
            </Box>
          )}
        </Button>
      </Box>
    );
  }

  if (isGuest) {
    const guestButton = (
      <Button
        type="button"
        variant="ghost"
        fullWidth
        title={isCollapsed ? "Guest" : undefined}
        className={cn(
          "h-auto min-w-0 justify-start gap-2 rounded-lg px-2 py-1.5 text-left",
          isCollapsed && "justify-center px-0",
        )}
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback>
              ?
          </AvatarFallback>
        </Avatar>
        {!isCollapsed && (
            <Box
              className="flex min-w-0 flex-1 flex-col"
            >
              <Typography
                noWrap
                weight="medium"
              >
                Guest mode
              </Typography>
            </Box>
          )}
      </Button>
    );

    return (
      <Box className="px-1.5 pb-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger render={guestButton} />
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <Box className="flex min-w-0 flex-col">
                  <Typography weight="medium" noWrap>
                    Guest
                  </Typography>
                </Box>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-3 whitespace-nowrap" onClick={() => onOpenSettings?.("profile")}>
                <Settings size={16} />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-3 whitespace-nowrap" onClick={() => setIsArchivedOpen(true)}>
                <Archive size={16} />
                <span>Archived Chats</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-3 whitespace-nowrap" onClick={() => actions.openAuth()}>
              <LogIn size={16} />
              <span>Log In</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ArchivedChatsDialog
          open={isArchivedOpen}
          onOpenChange={setIsArchivedOpen}
        />
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
  const avatarSeed = user.fullName?.trim() || user.email;

  const button = (
    <Button
      type="button"
      variant="ghost"
      fullWidth
      title={isCollapsed ? user.fullName || user.email : undefined}
      className={cn(
        "flex h-auto min-w-0 items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left",
        isCollapsed && "justify-center px-0",
      )}
    >
      <Box className="relative shrink-0">
        <Avatar className="size-7">
          {user.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt={user.fullName || user.email} />
          ) : (
            <AvatarFallback seed={avatarSeed}>{initials}</AvatarFallback>
          )}
        </Avatar>
      </Box>
      {!isCollapsed && (
          <Box
            className="flex min-w-0 flex-1 flex-col"
          >
            <Typography
              noWrap
              weight="medium"
            >
              {user.fullName || "User"}
            </Typography>
          </Box>
        )}
    </Button>
  );

  return (
    <Box className="px-1.5 pb-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger render={button} />
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="p-1.5">
              <Box className="flex min-w-0 items-center gap-2">
                <Avatar className="size-7 shrink-0">
                  {user.avatarUrl ? (
                    <AvatarImage src={user.avatarUrl} alt={user.fullName || user.email} />
                  ) : (
                    <AvatarFallback seed={avatarSeed}>{initials}</AvatarFallback>
                  )}
                </Avatar>
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography weight="medium" noWrap variant="small">
                    {user.fullName || "User"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {user.email}
                  </Typography>
                </Box>
              </Box>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-3 whitespace-nowrap" onClick={() => onOpenSettings?.("profile")}>
              <Settings size={16} />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-3 whitespace-nowrap" onClick={() => setIsArchivedOpen(true)}>
              <Archive size={16} />
              <span>Archived Chats</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-3 whitespace-nowrap"
            onClick={() => actions.logout()}
          >
            <LogOut size={16} />
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
