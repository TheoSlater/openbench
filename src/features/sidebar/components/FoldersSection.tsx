import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFolderStore } from "@/store/folderStore";
import { Conversation } from "@/types/chat";
import { FolderTree } from "@/features/sidebar/components/FolderTree";
import { useSidebarActions } from "@/features/sidebar/hooks/useSidebarActions";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import {
  SidebarSectionHeader,
  sidebarIconButtonClassName,
} from "@/features/sidebar/components/sidebar-utils";

const FOLDERS_COLLAPSED_STORAGE_KEY = "polyui:sidebar:folders-collapsed";
const FOLDERS_SECTION_CONTENT_ID = "sidebar-folders-section-content";

function readFoldersCollapsedPreference() {
  try {
    return localStorage.getItem(FOLDERS_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function useFoldersSectionCollapsed() {
  const [isCollapsed, setIsCollapsed] = React.useState(readFoldersCollapsedPreference);

  const setPersistedCollapsed = React.useCallback((next: boolean) => {
    setIsCollapsed(next);
    try {
      localStorage.setItem(FOLDERS_COLLAPSED_STORAGE_KEY, String(next));
    } catch {
      // Ignore unavailable storage; disclosure remains usable for this session.
    }
  }, []);

  return [isCollapsed, setPersistedCollapsed] as const;
}

export interface FoldersSectionProps {
  folderConversations: Conversation[];
  streamingConversationId: string | null;
}

export function FoldersSection({
  folderConversations,
  streamingConversationId,
}: FoldersSectionProps) {
  const folders = useFolderStore((s) => s.folders);
  const { folder } = useSidebarActions();
  const rootFolders = folders.filter((f) => !f.parentId);
  const [isCollapsed, setIsCollapsed] = useFoldersSectionCollapsed();

  return (
    <SidebarGroup className="mb-1">
      <div className="mb-0.5 px-3">
        <SidebarSectionHeader
          label="Folders"
          disclosure={{
            expanded: !isCollapsed,
            onToggle: () => setIsCollapsed(!isCollapsed),
            controlsId: FOLDERS_SECTION_CONTENT_ID,
          }}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Create folder"
              onClick={folder.openCreateModal}
              className={sidebarIconButtonClassName}
            >
              <Plus />
            </Button>
          }
        />
      </div>
      <div
        id={FOLDERS_SECTION_CONTENT_ID}
        hidden={isCollapsed}
        className="overflow-hidden"
      >
        <SidebarGroupContent>
          <SidebarMenu>
            {rootFolders.map((f) => (
              <FolderTree
                key={f.id}
                folder={f}
                folderConversations={folderConversations}
                streamingConversationId={streamingConversationId}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </div>
    </SidebarGroup>
  );
}
