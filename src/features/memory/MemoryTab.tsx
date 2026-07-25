import { useCallback, useEffect, useMemo, useState } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog-panel";
import { DialogActions } from "@/components/ui/dialog-panel";
import { DialogContent } from "@/components/ui/dialog-panel";
import { DialogTitle } from "@/components/ui/dialog-panel";
import { Divider } from "@/components/ui/divider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Stack } from "@/components/ui/Stack";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { Typography } from "@/components/ui/Typography";
import { FlaskConical, RefreshCcw, Search, Trash2 } from "lucide-react";
import { EmptyState, SectionHeader, SettingCard } from "@/features/settings/SettingComponents";
import { useNotify } from "@/hooks/useNotify";
import { getCurrentProviderAccountId } from "@/features/providers";
import {
  memoryClearAll,
  memoryDebugExtractLastTurn,
  memoryDelete,
  memoryGetSettings,
  memoryList,
  memorySearch,
  memoryTestConnection,
  memoryUpdate,
  memoryUpdateSettings,
} from "./memoryClient";
import type { MemoryRecord, MemorySettings } from "./types";

function localityLabel(settings: MemorySettings | null) {
  if (!settings?.enabled) return "Disabled";
  if (settings.provider === "disabled") return "Fully local";
  if (settings.locality === "remote") return "Remote";
  if (settings.locality === "partially_remote") return "Partially remote";
  return "Fully local";
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function parseValue(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function defaultSettings(ownerId: string, current?: MemorySettings | null): MemorySettings {
  return {
    enabled: false,
    provider: "disabled",
    automaticExtraction: false,
    requireSensitiveConfirmation: true,
    enableUserMemory: true,
    enableProjectMemory: true,
    enableChatMemory: true,
    allowTemporaryRecall: false,
    retrievalLimit: 8,
    tokenBudget: 600,
    extractionProviderId: null,
    extractionProvider: null,
    extractionModel: null,
    extractionApiBaseUrl: null,
    embeddingProviderId: null,
    embeddingProvider: null,
    embeddingModel: null,
    embeddingApiBaseUrl: null,
    mem0Endpoint: null,
    locality: "local",
    ...current,
    ownerId,
  };
}

export function MemoryTab() {
  const notify = useNotify();
  const ownerId = getCurrentProviderAccountId();
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; run: () => Promise<void> }>(null);

  const loadSettings = useCallback(async () => {
    if (!ownerId) return;
    const next = await memoryGetSettings(ownerId);
    setSettings(defaultSettings(ownerId, next));
  }, [ownerId]);

  const loadRecords = useCallback(async () => {
    if (!ownerId) return;
    const base = {
      ownerId,
      scope: null,
      scopeOwnerId: null,
      category: null,
      includeInactive,
      includeDeleted: false,
      limit: 100,
    };
    const next = query.trim()
      ? await memorySearch({ ...base, query: query.trim() })
      : await memoryList({ ...base, includeSuperseded: includeInactive, offset: 0 });
    setRecords(next);
  }, [includeInactive, ownerId, query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSettings(), loadRecords()])
      .catch((error) => !cancelled && notify.error("Memory load failed", String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadRecords, loadSettings, notify]);

  const saveSettings = useCallback(
    async (patch: Partial<MemorySettings>) => {
      if (!ownerId) return;
      const next = defaultSettings(ownerId, { ...settings, ...patch } as MemorySettings);
      setSettings(next);
      setSaving(true);
      try {
        const saved = await memoryUpdateSettings(next);
        setSettings(defaultSettings(ownerId, saved));
      } catch (error) {
        notify.error("Memory settings failed", String(error));
        void loadSettings();
      } finally {
        setSaving(false);
      }
    },
    [loadSettings, notify, ownerId, settings],
  );

  const testConnection = async () => {
    if (!ownerId) return;
    setTesting(true);
    try {
      const result = await memoryTestConnection(ownerId);
      notify[result.ok ? "success" : "error"]("Memory connection", result.message);
    } catch (error) {
      notify.error("Memory connection failed", String(error));
    } finally {
      setTesting(false);
    }
  };

  const runDebugExtraction = async () => {
    if (!ownerId) return;
    setExtracting(true);
    try {
      const record = await memoryDebugExtractLastTurn(ownerId);
      const detail = record.lastError ? `${record.state}: ${record.lastError}` : record.state;
      notify[record.state === "completed" ? "success" : "info"]("Extraction run", detail);
      await loadRecords();
    } catch (error) {
      notify.error("Extraction failed", String(error));
    } finally {
      setExtracting(false);
    }
  };

  const removeMemory = (record: MemoryRecord) => {
    setConfirm({
      title: "Delete memory",
      body: record.summary,
      run: async () => {
        await memoryDelete(ownerId, record.id);
        notify.success("Memory deleted");
        await loadRecords();
      },
    });
  };

  const clearAll = () => {
    setConfirm({
      title: "Clear all memories",
      body: "Deletes all memories for current profile.",
      run: async () => {
        await memoryClearAll(ownerId);
        notify.success("All memories cleared");
        await loadRecords();
      },
    });
  };

  const activeCount = useMemo(() => records.filter((record) => record.isActive && !record.deletedAt).length, [records]);
  const settingsReady = settings ?? defaultSettings(ownerId);

  if (!ownerId) {
    return <EmptyState>Memory needs profile or guest session.</EmptyState>;
  }

  return (
    <Stack spacing={0}>
      <SectionHeader
        title="Memory"
        description="Memory allows Poly UI to remember useful information across chats."
        action={<Chip size="small" label={localityLabel(settings)} />}
      />

      <SettingCard
        title="Enable memory"
        description="Disabled by default. No recall or extraction runs while off."
        action={<Switch checked={settingsReady.enabled} disabled={saving} onChange={(e) => saveSettings({ enabled: e.target.checked })} />}
      />
      <SettingCard
        title="Automatic extraction"
        description="Runs after completed persisted turns. Temporary chats are skipped."
        action={<Switch checked={settingsReady.automaticExtraction} disabled={!settingsReady.enabled || saving} onChange={(e) => saveSettings({ automaticExtraction: e.target.checked })} />}
      />

      <SectionHeader
        title="Your memories"
        description={`${activeCount} active shown.`}
        action={
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RefreshCcw size={14} />} onClick={loadRecords}>Refresh</Button>
            <Button size="small" disabled={testing} onClick={testConnection}>{testing ? "Testing..." : "Test"}</Button>
          </Stack>
        }
      />
      <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memories" size="small" fullWidth InputProps={{ startAdornment: <Search size={14} /> }} />
      <Stack spacing={1}>
        {loading ? <EmptyState>Loading memories...</EmptyState> : records.length === 0 ? <EmptyState>No memories found.</EmptyState> : records.map((record) => (
          <MemoryRow key={record.id} record={record} onEdit={setEditing} onDelete={removeMemory} />
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button size="small" color="error" variant="text" onClick={clearAll} startIcon={<Trash2 size={14} />}>
          Clear all
        </Button>
      </Stack>

      <details>
        <summary className="cursor-pointer py-3 text-sm">Advanced settings</summary>
        <Stack spacing={0}>
          <SettingCard
            title="Memory provider"
            description="Native local storage is active. Mem0 adapter lands in next phase."
            action={
              <Select
                value={settingsReady.provider}
                onValueChange={(value) =>
                  saveSettings({ provider: value, locality: value === "disabled" ? "local" : "remote" })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="mem0" disabled>Mem0</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            }
          />
          <SettingCard
            title="Require sensitive confirmation"
            description="Deterministic filter rejects keys, tokens, private credentials and similar secrets."
            action={<Switch checked={settingsReady.requireSensitiveConfirmation} disabled={!settingsReady.enabled || saving} onChange={(e) => saveSettings({ requireSensitiveConfirmation: e.target.checked })} />}
          />
          {[
            ["enableUserMemory", "User memory", "Across chats for current profile."],
            ["enableProjectMemory", "Project memory", "Only inside relevant workspace or folder."],
            ["enableChatMemory", "Chat memory", "Only inside originating conversation."],
          ].map(([key, title, description]) => (
            <SettingCard
              key={key}
              title={title}
              description={description}
              action={<Switch checked={Boolean(settingsReady[key as keyof MemorySettings])} disabled={!settingsReady.enabled || saving} onChange={(e) => saveSettings({ [key]: e.target.checked } as Partial<MemorySettings>)} />}
            />
          ))}
          <SettingCard
            title="Temporary chat recall"
            description="Off by default. Temporary chats never write persistent memories automatically."
            action={<Switch checked={settingsReady.allowTemporaryRecall} disabled={!settingsReady.enabled || saving} onChange={(e) => saveSettings({ allowTemporaryRecall: e.target.checked })} />}
          />
          <SettingCard title="Memory retrieval limit" description={`${settingsReady.retrievalLimit} memories maximum`}>
            <Slider min={1} max={20} value={settingsReady.retrievalLimit} disabled={!settingsReady.enabled || saving} onChange={(_, value) => saveSettings({ retrievalLimit: value as number })} />
          </SettingCard>
          <SettingCard title="Memory token budget" description={`${settingsReady.tokenBudget} approximate tokens`}>
            <Slider min={100} max={2000} step={50} value={settingsReady.tokenBudget} disabled={!settingsReady.enabled || saving} onChange={(_, value) => saveSettings({ tokenBudget: value as number })} />
          </SettingCard>
          <SettingCard
            title="Show superseded memories"
            description="Includes inactive historical values for inspection."
            action={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
          />
          <SettingCard
            title="Run extraction on last turn"
            description="Debug: re-runs memory extraction against the most recent completed turn."
            action={
              <Button size="small" startIcon={<FlaskConical size={14} />} disabled={extracting || !settingsReady.enabled} onClick={runDebugExtraction}>
                {extracting ? "Running..." : "Run"}
              </Button>
            }
          />
        </Stack>
      </details>

      <EditMemoryDialog record={editing} ownerId={ownerId} onClose={() => setEditing(null)} onSaved={loadRecords} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </Stack>
  );
}

function MemoryRow({ record, onEdit, onDelete }: { record: MemoryRecord; onEdit: (record: MemoryRecord) => void; onDelete: (record: MemoryRecord) => void }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Box>
          <Typography>{record.summary}</Typography>
          <Typography>{record.canonicalKey ?? "uncategorized"} · {record.scope} · {record.category}</Typography>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Button size="small" onClick={() => onEdit(record)}>Edit</Button>
          <Button size="small" color="error" onClick={() => onDelete(record)}>Delete</Button>
        </Stack>
      </Stack>
      <Divider />
      <Typography as="pre">
        {formatValue(record.value)}
      </Typography>
      <details>
        <summary className="mt-2 cursor-pointer text-xs">Metadata</summary>
        <Typography>
          confidence {record.confidence.toFixed(2)} · importance {record.importance.toFixed(2)} · sync {record.syncStatus}
          <br />
          source {record.sourceChatId ?? "none"} · created {new Date(record.createdAt).toLocaleString()} · updated {new Date(record.updatedAt).toLocaleString()}
          {record.supersedesId ? <><br />supersedes {record.supersedesId}</> : null}
          {record.syncError ? <><br />sync error {record.syncError}</> : null}
        </Typography>
      </details>
    </Box>
  );
}

function EditMemoryDialog({ record, ownerId, onClose, onSaved }: { record: MemoryRecord | null; ownerId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const notify = useNotify();
  const [summary, setSummary] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSummary(record?.summary ?? "");
    setValue(record ? formatValue(record.value) : "");
  }, [record]);

  const save = async () => {
    if (!record) return;
    setSaving(true);
    try {
      await memoryUpdate({ ownerId, memoryId: record.id, summary, value: parseValue(value) });
      notify.success("Memory updated");
      await onSaved();
      onClose();
    } catch (error) {
      notify.error("Memory update failed", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(record)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit memory</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <TextField label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} size="small" fullWidth />
          <TextField label="Value" value={value} onChange={(e) => setValue(e.target.value)} size="small" fullWidth multiline minRows={5} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !summary.trim()} variant="contained" disableElevation>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({ confirm, onClose }: { confirm: null | { title: string; body: string; run: () => Promise<void> }; onClose: () => void }) {
  const notify = useNotify();
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (!confirm) return;
    setRunning(true);
    try {
      await confirm.run();
      onClose();
    } catch (error) {
      notify.error("Memory action failed", String(error));
    } finally {
      setRunning(false);
    }
  };
  return (
    <Dialog open={Boolean(confirm)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{confirm?.title}</DialogTitle>
      <DialogContent><Typography>{confirm?.body}</Typography></DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={running} onClick={run} disableElevation>Confirm</Button>
      </DialogActions>
    </Dialog>
  );
}
