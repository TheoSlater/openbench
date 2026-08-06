import * as React from "react";
import { MoreHorizontal, LogIn, Settings, Archive } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArchivedChatsDialog } from "@/features/chat/components/ArchivedChatsDialog";
import { useAuthStore } from "@/store/authStore";
import { useSidebar } from "@/components/ui/sidebar";
import { sidebarIconButtonClassName } from "@/features/sidebar/components/sidebar-utils";

export function GuestFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const openAuth = useAuthStore((s) => s.actions.openAuth);
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [archivedOpen, setArchivedOpen] = React.useState(false);

  if (isCollapsed) {
    return (
      <>
        <DropdownMenu>
          <div className="flex justify-center">
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Guest menu"
                  className={`${sidebarIconButtonClassName} bg-muted hover:bg-muted/80`}
                >
                  <Avatar size="sm">
                    <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                      ?
                    </AvatarFallback>
                  </Avatar>
                </Button>
              }
            />
          </div>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={onOpenSettings} className="gap-2">
              <Settings size={14} />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setArchivedOpen(true)}
              className="gap-2"
            >
              <Archive size={14} />
              <span>Archived Chats</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAuth()} className="gap-2">
              <LogIn size={14} />
              <span>Sign in</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ArchivedChatsDialog
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
        />
      </>
    );
  }

  return (
    <>
      <div
        data-testid="guest-footer-flat"
        className="flex items-center gap-1 px-1.5 pb-0.5"
      >
        <Button
          type="button"
          variant="ghost"
          aria-label="Sign in"
          onClick={() => openAuth()}
          className="min-w-0 flex-1 justify-start gap-2 px-2"
        >
          <Avatar className="size-6 shrink-0">
            <AvatarFallback className="bg-muted text-xs text-muted-foreground">
              ?
            </AvatarFallback>
          </Avatar>
          <span className="truncate">Guest</span>
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Sign in
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More options"
              className={sidebarIconButtonClassName}
            >
              <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={onOpenSettings} className="gap-2">
              <Settings size={14} />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setArchivedOpen(true)}
              className="gap-2"
            >
              <Archive size={14} />
              <span>Archived Chats</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ArchivedChatsDialog open={archivedOpen} onOpenChange={setArchivedOpen} />
    </>
  );
}
