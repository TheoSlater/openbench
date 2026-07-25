"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chatStore"
import { DeleteConversationDialog } from "@/features/chat/components/DeleteConversationDialog"
import {
  SidebarActionsProvider,
  useSidebarActions,
} from "@/features/sidebar/hooks/useSidebarActions"
import { useConversationGroups } from "@/features/sidebar/hooks/useConversationGroups"
import { useFolderStore } from "@/store/folderStore"
import { useReducedMotion } from "@/hooks/useReducedMotion"
import { SidebarBrand } from "@/features/sidebar/components/SidebarBrand"
import { FoldersSection } from "@/features/sidebar/components/FoldersSection"
import { ConversationList } from "@/features/sidebar/components/ConversationList"
import { CreateFolderDialog } from "@/features/sidebar/components/CreateFolderDialog"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/utils/platform"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import type { SettingsTab } from "@/features/settings/SettingsModal"
import type { Conversation } from "@/types/chat"

interface AppSidebarBodyProps {
  onOpenSettings: (tab?: SettingsTab) => void
  onOpenCommandPalette: () => void
  onNewChat: () => void
  conversations: Conversation[]
}

function AppSidebarBody({
  onOpenSettings,
  onOpenCommandPalette,
  onNewChat,
  conversations,
}: AppSidebarBodyProps) {
  const conversationsLoading = useChatStore(
    (state) => state.conversationsLoading,
  )
  const streamingConversationId = useChatStore(
    (state) => state.streamingConversationId,
  )
  const loadFolders = useFolderStore((s) => s.actions.loadFolders)
  const { conv, folder } = useSidebarActions()
  const reduceMotion = useReducedMotion()
  const groupedConversations = useConversationGroups(conversations)
  const folderConversations = React.useMemo(
    () =>
      conversations.filter(
        (c) => c.folderId && !c.isArchived && !c.isTemporary,
      ),
    [conversations],
  )

  React.useEffect(() => {
    loadFolders()
  }, [loadFolders])

  return (
    <>
      <SidebarHeader className={IS_MAC || USE_CUSTOM_WINDOW_CONTROLS ? "p-0" : undefined}>
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        <NavMain onNewChat={onNewChat} onSearch={onOpenCommandPalette} />

        <div className={cn("flex min-h-0 flex-col gap-(--sidebar-section-gap) group-data-[collapsible=icon]:invisible group-data-[collapsible=icon]:opacity-0", !reduceMotion && "transition-[opacity,visibility] duration-(--sidebar-transition-duration) ease-(--sidebar-transition-easing)")}>
          <FoldersSection
            folderConversations={folderConversations}
            streamingConversationId={streamingConversationId}
          />

          <ConversationList
            groupedConversations={groupedConversations}
            conversationsLoading={conversationsLoading}
            streamingConversationId={streamingConversationId}
          />
        </div>
      </SidebarContent>

      <SidebarFooter>
        <NavUser onOpenSettings={onOpenSettings} />
      </SidebarFooter>

      <DeleteConversationDialog
        open={conv.isDeleteDialogOpen}
        onOpenChange={conv.setIsDeleteDialogOpen}
        onConfirm={conv.handleConfirmDelete}
        title={conv.deleteTitle}
      />

      <CreateFolderDialog folder={folder} />
    </>
  )
}

interface AppSidebarProps {
  onOpenSettings: (tab?: SettingsTab) => void
  onOpenCommandPalette: () => void
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => Promise<void>
  onRenameConversation: (id: string, newTitle: string) => Promise<void>
  conversations: Conversation[]
  activeConversationId: string | null
  collapsible?: "icon" | "none"
}

export const AppSidebar = React.memo(function AppSidebar({
  onOpenSettings,
  onOpenCommandPalette,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  conversations,
  collapsible = "icon",
}: AppSidebarProps) {
  return (
    <SidebarActionsProvider
      conversations={conversations}
      onDeleteConversation={onDeleteConversation}
      onRenameConversation={onRenameConversation}
      onSelectConversation={onSelectConversation}
    >
      <Sidebar collapsible={collapsible}>
        <AppSidebarBody
          onOpenSettings={onOpenSettings}
          onOpenCommandPalette={onOpenCommandPalette}
          onNewChat={onNewChat}
          conversations={conversations}
        />
      </Sidebar>
    </SidebarActionsProvider>
  )
})
