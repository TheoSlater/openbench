import { SquarePen, Search } from "lucide-react"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { shortcutKeys } from "@/features/shortcuts/registry"
import { KEY_SEP } from "@/lib/utils/platform"
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
              className="font-medium"
            >
              <SquarePen />
              <span>New Chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={`Search (${shortcutKeys("search")?.join(KEY_SEP)})`}
              aria-keyshortcuts="Meta+K Control+K"
              onClick={onSearch}
              className="font-medium"
            >
              <Search />
              <span>Search</span>
              {/* Hint stays out of the way until the row is hovered or
                  keyboard-focused — matching the conversation row actions. */}
              <KbdGroup className="ml-auto opacity-0 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-soft)] group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 [@media(hover:none)]:opacity-100 group-data-[collapsible=icon]:hidden">
                {shortcutKeys("search")?.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
