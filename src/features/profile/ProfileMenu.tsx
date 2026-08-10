import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
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
import { Button } from "@/components/ui/button";
import { Settings, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { profileInitials, profileLabel } from "@/features/onboarding/profile";
import { useSidebar } from "@/components/ui/sidebar";
import { ArchivedChatsDialog } from "@/features/chat/components/ArchivedChatsDialog";
import type { SettingsTab } from "@/features/settings/SettingsModal";

interface ProfileMenuProps {
  onOpenSettings?: (tab?: SettingsTab) => void;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ onOpenSettings }) => {
  const { user, isLoading } = useAuthStore(
    useShallow((state) => ({ user: state.user, isLoading: state.isLoading })),
  );
  const { profile, profileConfigured } = useSettingsStore(
    useShallow((state) => ({
      profile: state.profile,
      profileConfigured: state.profileConfigured,
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
          {!isCollapsed && <Box className="h-2.5 w-20 rounded-full bg-muted" />}
        </Button>
      </Box>
    );
  }

  const name = profileConfigured
    ? profileLabel(profile.displayName)
    : profileLabel(user?.fullName ?? "");
  const avatarUrl = profileConfigured ? profile.avatarUrl : user?.avatarUrl;
  const initials = profileInitials(name);
  const avatar = (
    <Avatar className="size-7 shrink-0">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback seed={name}>{initials}</AvatarFallback>
    </Avatar>
  );
  const button = (
    <Button
      type="button"
      variant="ghost"
      fullWidth
      title={isCollapsed ? name : undefined}
      className={cn(
        "h-auto min-w-0 justify-start gap-2 rounded-lg px-2 py-1.5 text-left",
        isCollapsed && "justify-center px-0",
      )}
    >
      {avatar}
      {!isCollapsed && (
        <Box className="flex min-w-0 flex-1 flex-col">
          <Typography noWrap weight="medium">
            {name}
          </Typography>
        </Box>
      )}
    </Button>
  );

  return (
    <Box className="px-1.5 pb-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger render={button} />
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="p-1.5">
              <Box className="flex min-w-0 items-center gap-2">
                {avatar}
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography weight="medium" noWrap variant="small">
                    {name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    Local profile
                  </Typography>
                </Box>
              </Box>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-3 whitespace-nowrap"
              onClick={() => onOpenSettings?.("personalization")}
            >
              <Settings size={16} />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-3 whitespace-nowrap"
              onClick={() => setIsArchivedOpen(true)}
            >
              <Archive size={16} />
              <span>Archived Chats</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ArchivedChatsDialog open={isArchivedOpen} onOpenChange={setIsArchivedOpen} />
    </Box>
  );
};
