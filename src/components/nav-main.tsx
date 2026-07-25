import { SquarePen, Search } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"


interface NavMainProps {
  onNewChat: () => void
  onSearch: () => void
}

export function NavMain({ onNewChat, onSearch }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New Chat"
              onClick={onNewChat}
              className="bg-sidebar-accent/70 font-medium hover:bg-sidebar-accent"
            >
              <SquarePen />
              <span>New Chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search (⌘K)"
              aria-keyshortcuts="Meta+K Control+K"
              onClick={onSearch}
            >
              <Search />
              <span>Search</span>
              <kbd className="ml-auto rounded-md bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                ⌘K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
