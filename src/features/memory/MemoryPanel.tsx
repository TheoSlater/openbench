import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Search } from "lucide-react";
import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CircularProgress } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNotify } from "@/hooks/useNotify";
import { getCurrentProviderAccountId } from "@/features/providers";
import { memoryDelete, memoryListForChat } from "./memoryClient";
import type { MemoryRecord } from "./types";

// Panel open state lives here so message dropdowns deep in the virtualized
// tree can open the panel without prop drilling through ChatArea.
const useMemoryPanelStore = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);

export function openMemoryPanel() {
  useMemoryPanelStore.getState().setOpen(true);
}

export function useMemoryPanelOpen() {
  return useMemoryPanelStore((state) => state.open);
}

export function setMemoryPanelOpen(open: boolean) {
  useMemoryPanelStore.getState().setOpen(open);
}

type MemoryPanelProps = {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onChanged?: () => void;
};

export function MemoryPanel({ open, onClose, conversationId, onChanged }: MemoryPanelProps) {
  const notify = useNotify();
  const ownerId = getCurrentProviderAccountId();
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<MemoryRecord | null>(null);

  useEffect(() => {
    if (!open || !ownerId || !conversationId) return;
    let cancelled = false;
    setLoading(true);
    memoryListForChat(ownerId, conversationId)
      .then((next) => !cancelled && setRecords(next))
      .catch((error) => !cancelled && notify.error("Memory load failed", String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [conversationId, notify, open, ownerId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter(
      (record) =>
        record.summary.toLowerCase().includes(needle) ||
        String(record.value ?? "").toLowerCase().includes(needle) ||
        (record.canonicalKey ?? "").toLowerCase().includes(needle),
    );
  }, [query, records]);

  const confirmDelete = async () => {
    if (!deleting || !ownerId) return;
    try {
      await memoryDelete(ownerId, deleting.id);
      setRecords((current) => current.filter((record) => record.id !== deleting.id));
      notify.success("Memory deleted");
      onChanged?.();
    } catch (error) {
      notify.error("Memory delete failed", String(error));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader className="pb-3">
          <SheetTitle>Memories</SheetTitle>
          <SheetDescription>Memories linked to this conversation.</SheetDescription>
        </SheetHeader>
        <Box className="px-6 pb-3">
          <TextField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories"
            size="small"
            fullWidth
            InputProps={{ startAdornment: <Search size={14} /> }}
          />
        </Box>
        <Box className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <Box className="flex justify-center py-10 text-muted-foreground">
              <CircularProgress size={20} color="inherit" />
            </Box>
          ) : filtered.length === 0 ? (
            <Typography variant="body2" color="text.secondary" className="py-10 text-center">
              {records.length === 0
                ? "No memories for this conversation yet"
                : "No memories match your search"}
            </Typography>
          ) : (
            <Box className="flex flex-col gap-2">
              {filtered.map((record) => (
                <MemoryPanelRow key={record.id} record={record} onDelete={setDeleting} />
              ))}
            </Box>
          )}
        </Box>
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(next) => !next && setDeleting(null)}
          title="Delete memory"
          description={deleting?.summary}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDelete}
        />
      </SheetContent>
    </Sheet>
  );
}

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function MemoryPanelRow({
  record,
  onDelete,
}: {
  record: MemoryRecord;
  onDelete: (record: MemoryRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box className="rounded-2xl border border-border/60 bg-card p-3">
      <Box className="flex items-start justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={() => setExpanded((v) => !v)}>
          <Typography variant="body2" weight="medium">
            {record.summary}
          </Typography>
        </button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(record)}>
          Delete
        </Button>
      </Box>
      {expanded && (
        <Typography as="pre" variant="caption" className="mt-2 whitespace-pre-wrap break-words">
          {formatValue(record.value)}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" className="mt-1 block">
        {record.category} · confidence {record.confidence.toFixed(2)} · importance{" "}
        {record.importance.toFixed(2)} · {new Date(record.createdAt).toLocaleDateString()}
      </Typography>
    </Box>
  );
}
