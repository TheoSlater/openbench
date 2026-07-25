import * as React from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Folder, MessageSquare, Trash2, X } from "lucide-react";
import { ChatInput } from "@/features/chat/components/ChatInput";
import { ConversationItem } from "@/features/chat/components/ConversationItem";
import { DeleteConversationDialog } from "@/features/chat/components/DeleteConversationDialog";
import { useChatStore } from "@/store/chatStore";
import { useNotify } from "@/hooks/useNotify";
import { getRepository } from "@/lib/repositories";
import type { Folder as FolderType, Conversation } from "@/types/chat";
import { FolderSources } from "./FolderSources";

type FolderHomeProps = {
  folder: FolderType;
  onSubmit: (value: string) => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  providerOnline: boolean;
  onOpenConnections: () => void;
  onOpenVoiceMode?: () => void;
};

export function FolderHome({ folder, onSubmit, onStop, isStreaming, providerOnline, onOpenConnections, onOpenVoiceMode }: FolderHomeProps) {
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const setActiveConversationId = useChatStore((state) => state.actions.setActiveConversationId);
  const streamingConversationId = useChatStore((state) => state.streamingConversationId);
  const deleteConversation = useChatStore((state) => state.actions.deleteConversation);
  const deleteConversations = useChatStore((state) => state.actions.deleteConversations);
  const renameConversation = useChatStore((state) => state.actions.renameConversation);
  const archiveConversation = useChatStore((state) => state.actions.archiveConversation);
  const notify = useNotify();

  const chats = conversations.filter((conversation) => conversation.folderId === folder.id && !conversation.isArchived);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleteTitle, setDeleteTitle] = React.useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = React.useState(false);

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
      try {
        await renameConversation(id, editValue.trim());
        notify.success("Conversation renamed");
      } catch {
        notify.error("Failed to rename conversation");
      }
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(null);
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveConversation(id);
      notify.success("Conversation archived");
    } catch {
      notify.error("Failed to archive");
    }
  };

  const handleStartDelete = (conv: Conversation) => {
    setDeleteId(conv.id);
    setDeleteTitle(conv.title || "Untitled");
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteId) {
      try {
        await deleteConversation(deleteId);
        notify.success("Conversation deleted");
      } catch {
        notify.error("Failed to delete conversation");
      }
      setDeleteId(null);
      setDeleteTitle("");
    }
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  const handleSelectAll = () => {
    setSelectedIds(new Set(chats.map((c) => c.id)));
  };

  const handleBatchDelete = () => {
    setIsBatchDeleteDialogOpen(true);
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await deleteConversations(Array.from(selectedIds));
      notify.success(`Deleted ${selectedIds.size} conversation${selectedIds.size > 1 ? "s" : ""}`);
    } catch {
      notify.error("Failed to delete conversations");
    }
    setSelectedIds(new Set());
  };

  const handleExport = async (conv: Conversation) => {
    try {
      const repo = await getRepository();
      const messages = await repo.getMessages(conv.id, 99999, 0);
      const payload = { conversation: conv, messages };
      const json = JSON.stringify(payload, null, 2);
      const fileName = `${(conv.title || "untitled").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;

      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const filePath = await save({
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: fileName,
        });
        if (!filePath) return;
        await writeTextFile(filePath, json);
      } catch {
        const url = URL.createObjectURL(
          new Blob([json], { type: "application/json" })
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      notify.success("Conversation exported");
    } catch (err) {
      notify.error("Failed to export conversation", String(err));
    }
  };

  return (
    <Box className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-6 px-6 pt-12">
      <Box flex alignItems="center" gap={2} className="self-start">
        <Folder size={20} />
        <Typography variant="h6">{folder.name}</Typography>
      </Box>

      <ChatInput
        onSubmit={onSubmit}
        onStop={onStop}
        isStreaming={isStreaming}
        onOpenVoiceMode={onOpenVoiceMode}
      />

      {!providerOnline && (
        <Box className="w-full">
          <Box>
            <Typography>No provider connected</Typography>
            <Typography>Start Ollama, then connect it to chat in this folder.</Typography>
          </Box>
          <Button variant="outline" onClick={onOpenConnections}>
            Open Connections
          </Button>
        </Box>
      )}

      <Tabs defaultValue="chats" className="w-full">
        <TabsList>
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
        </TabsList>

        <TabsContent value="sources">
          <FolderSources folder={folder} />
        </TabsContent>

        <TabsContent value="chats">
          {selectedIds.size > 0 && (
            <Box>
              <Typography>
                {selectedIds.size} selected
              </Typography>
              <Typography
                as="button"
                onClick={selectedIds.size === chats.length ? handleClearSelection : handleSelectAll}
              >
                {selectedIds.size === chats.length ? "Deselect all" : "Select all"}
              </Typography>
              <IconButton
                size="small"
                aria-label="Delete selected conversations"
                onClick={handleBatchDelete}
              >
                <Trash2 size={16} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Clear selection"
                onClick={handleClearSelection}
              >
                <X size={16} />
              </IconButton>
            </Box>
          )}

          {chats.length === 0 ? (
            <Box className="flex flex-col items-center text-center">
              <MessageSquare size={32} className="mb-3 opacity-30" />
              <Typography>Start a chat in this folder</Typography>
              <Typography>New conversations will stay grouped in {folder.name}.</Typography>
            </Box>
          ) : (
            <Box>
              {chats.map((chat) => (
                <ConversationItem
                  key={chat.id}
                  conv={chat}
                  activeConversationId={activeConversationId}
                  isGenerating={streamingConversationId === chat.id}
                  onClick={() => setActiveConversationId(chat.id)}
                  variant="folder"
                  selected={selectedIds.has(chat.id)}
                  onToggleSelect={toggleSelect}
                  editingId={editingId}
                  editValue={editValue}
                  setEditValue={setEditValue}
                  handleConfirmRename={handleConfirmRename}
                  handleCancelRename={handleCancelRename}
                  handleStartRename={handleStartRename}
                  handleArchive={handleArchive}
                  handleStartDelete={handleStartDelete}
                  onExport={handleExport}
                />
              ))}
            </Box>
          )}

          <DeleteConversationDialog
            open={isDeleteDialogOpen}
            onOpenChange={setIsDeleteDialogOpen}
            onConfirm={handleConfirmDelete}
            title={deleteTitle}
          />
          <DeleteConversationDialog
            open={isBatchDeleteDialogOpen}
            onOpenChange={setIsBatchDeleteDialogOpen}
            onConfirm={handleConfirmBatchDelete}
            count={selectedIds.size}
          />
        </TabsContent>
      </Tabs>
    </Box>
  );
}
