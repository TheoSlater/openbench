import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/spinner";
import { Stack } from "@/components/ui/Stack";
import { Trash2, Archive, Download } from "lucide-react";
import { SettingCard, SectionHeader } from "../SettingComponents";
import { useChatStore } from "@/store/chatStore";
import { useNotify } from "@/hooks/useNotify";
import { getRepository } from "@/lib/repositories";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function DataControlsTab() {
  const notify = useNotify();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      const { deleteAllConversations } = useChatStore.getState().actions;
      await deleteAllConversations();
      notify.success("All chats deleted");
      setDeleteOpen(false);
    } catch (err) {
      notify.error("Failed to delete chats", err as string);
    } finally {
      setDeleting(false);
    }
  };

  const handleArchiveAll = async () => {
    setArchiving(true);
    try {
      const { conversations, actions } = useChatStore.getState();
      for (const conv of conversations) {
        await actions.archiveConversation(conv.id);
      }
      notify.success("All chats archived");
      setArchiveOpen(false);
    } catch (err) {
      notify.error("Failed to archive chats", err as string);
    } finally {
      setArchiving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const repo = getRepository();
      const conversations = await repo.getConversations();
      const messages = await repo.getAllMessages();
      const messagesByConversation = new Map<string, typeof messages>();
      for (const message of messages) {
        const list = messagesByConversation.get(message.conversationId);
        if (list) list.push(message);
        else messagesByConversation.set(message.conversationId, [message]);
      }

      const payload = conversations.map((conv) => ({
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        isArchived: conv.isArchived,
        messages: (messagesByConversation.get(conv.id) ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          model: m.model,
          provider: m.provider,
          attachments: m.attachments,
          thinking: m.thinking,
          thinkingDuration: m.thinkingDuration,
        })),
      }));

      const json = JSON.stringify(payload, null, 2);
      const date = new Date().toISOString().slice(0, 10);
      const defaultName = `polyui-export-${date}.json`;

      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const filePath = await save({
          filters: [{ name: "JSON", extensions: ["json"] }],
          defaultPath: defaultName,
        });
        if (!filePath) { setExporting(false); return; }
        await writeTextFile(filePath, json);
        notify.success(`Exported ${conversations.length} conversations`);
      } catch {
        // Fallback for non-Tauri
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = defaultName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        notify.success(`Exported ${conversations.length} conversations`);
      }
    } catch (err) {
      notify.error("Failed to export chats", String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <SectionHeader
        title="Data Controls"
        description="Manage your conversation data."
      />

      <SettingCard
        title="Export Chats"
        description="Export all conversations as JSON."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={exporting}
            startIcon={
              exporting ? <CircularProgress size={14} /> : <Download size={14} />
            }
          >
            {exporting ? "Exporting..." : "Export"}
          </Button>
        }
      />

      <SettingCard
        title="Archive All Chats"
        description="Move all conversations to the archived state."
        action={
          <Button
            size="sm"
            variant="outline"
            color="warning"
            onClick={() => setArchiveOpen(true)}
            startIcon={<Archive size={14} />}
          >
            Archive All
          </Button>
        }
      />

      <SettingCard
        title="Delete All Chats"
        description="Permanently remove all conversations and messages."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            startIcon={<Trash2 size={14} />}
          >
            Delete All
          </Button>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => { if (!deleting) setDeleteOpen(open); }}
        title="Delete all chats?"
        description="This will permanently delete all conversations and messages. This action cannot be undone."
        confirmLabel={deleting ? "Deleting..." : "Delete All"}
        onConfirm={handleDeleteAll}
        destructive
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => { if (!archiving) setArchiveOpen(open); }}
        title="Archive all chats?"
        description="All conversations will be archived. You can view archived chats from the profile menu."
        confirmLabel={archiving ? "Archiving..." : "Archive All"}
        onConfirm={handleArchiveAll}
      />
    </Stack>
  );
}
