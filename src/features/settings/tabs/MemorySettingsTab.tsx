import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingRow } from "../SettingsShell";
import { useSettingsStore } from "@/store/settingsStore";
import {
  memoryClearAll,
  memoryDelete,
  memoryGetSettings,
  memoryList,
  memorySearch,
  memoryUpdateSettings,
} from "@/features/memory/memoryClient";
import type { MemoryRecord, MemorySettings } from "@/features/memory/types";
import { MEMORY_UPDATED_EVENT } from "@/features/memory/useConversationMemoryCount";
import { getCurrentProviderAccountId } from "@/features/providers";
import { useNotify } from "@/hooks/useNotify";

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

export function MemorySettingsTab() {
  const notify = useNotify();
  const memoryBeta = useSettingsStore((s) => s.general.memoryBeta);
  const ownerId = getCurrentProviderAccountId();
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

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
      includeInactive: false,
      includeDeleted: false,
      limit: 100,
    };
    const next = query.trim()
      ? await memorySearch({ ...base, query: query.trim() })
      : await memoryList({ ...base, includeSuperseded: false, offset: 0 });
    setRecords(next);
  }, [ownerId, query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadSettings(), loadRecords()])
      .catch((error) => !cancelled && notify.error("Memory load failed", String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [loadRecords, loadSettings, notify]);

  // Refresh the list when extraction saves memories while this tab is open.
  useEffect(() => {
    const onUpdate = () => void loadRecords().catch(() => undefined);
    window.addEventListener(MEMORY_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(MEMORY_UPDATED_EVENT, onUpdate);
  }, [loadRecords]);

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

  const removeMemory = useCallback(
    async (record: MemoryRecord) => {
      if (!ownerId) return;
      try {
        await memoryDelete(ownerId, record.id);
        notify.success("Memory deleted");
        await loadRecords();
      } catch (error) {
        notify.error("Delete failed", String(error));
      }
    },
    [loadRecords, notify, ownerId],
  );

  const clearAll = useCallback(async () => {
    if (!ownerId) return;
    try {
      await memoryClearAll(ownerId);
      notify.success("All memories cleared");
      await loadRecords();
    } catch (error) {
      notify.error("Clear failed", String(error));
    }
  }, [loadRecords, notify, ownerId]);

  const activeCount = useMemo(
    () => records.filter((r) => r.isActive && !r.deletedAt).length,
    [records],
  );
  const s = settings ?? defaultSettings(ownerId);

  if (!ownerId) {
    return (
      <SettingsSection title="Memory" description="Sign in to enable memory.">
        <p className="text-sm text-muted-foreground">
          Memory requires a profile or guest session.
        </p>
      </SettingsSection>
    );
  }

  if (!memoryBeta) {
    return (
      <SettingsSection title="Memory" description="Memory is not enabled.">
        <p className="text-sm text-muted-foreground">
          Enable Memory (Beta) in Advanced Settings to configure memory.
        </p>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title="Memory (Beta)"
        description="Automatically remember and recall information across chats."
      >
        <SettingRow
          title="Enable memory"
          description="No recall or extraction runs while off."
          action={
            <Switch
              checked={s.enabled}
              disabled={saving}
              onCheckedChange={(checked) =>
                // Extraction is gated on both flags — enabling memory with
                // extraction off silently does nothing, so turn both on.
                saveSettings(
                  checked ? { enabled: true, automaticExtraction: true } : { enabled: false },
                )
              }
            />
          }
        />
        <SettingRow
          title="Automatic extraction"
          description="Extracts memories from completed turns. Temporary chats are skipped."
          action={
            <Switch
              checked={s.automaticExtraction}
              disabled={!s.enabled || saving}
              onCheckedChange={(checked) => saveSettings({ automaticExtraction: checked })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Scopes"
        description="Control which conversation contexts can store and recall memories."
      >
        <SettingRow
          title="User memory"
          description="Across all chats for this profile."
          action={
            <Switch
              checked={s.enableUserMemory}
              disabled={!s.enabled || saving}
              onCheckedChange={(checked) => saveSettings({ enableUserMemory: checked })}
            />
          }
        />
        <SettingRow
          title="Chat memory"
          description="Only within the originating conversation."
          action={
            <Switch
              checked={s.enableChatMemory}
              disabled={!s.enabled || saving}
              onCheckedChange={(checked) => saveSettings({ enableChatMemory: checked })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Retrieval"
        description="How many memories are recalled and how much prompt space they use."
      >
        <SettingRow
          title="Retrieval limit"
          description={`${s.retrievalLimit} memories maximum per message.`}
          action={
            <div className="flex items-center gap-3">
              <Slider
                value={s.retrievalLimit}
                min={1}
                max={20}
                disabled={!s.enabled || saving}
                onValueChange={([value]) => saveSettings({ retrievalLimit: value })}
              />
              <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">
                {s.retrievalLimit}
              </span>
            </div>
          }
        />
        <SettingRow
          title="Token budget"
          description={`${s.tokenBudget} approximate tokens for memory context.`}
          action={
            <div className="flex items-center gap-3">
              <Slider
                value={s.tokenBudget}
                min={100}
                max={2000}
                step={50}
                disabled={!s.enabled || saving}
                onValueChange={([value]) => saveSettings({ tokenBudget: value })}
              />
              <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                {s.tokenBudget}
              </span>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Stored Memories"
        description={`${activeCount} active ${activeCount === 1 ? "memory" : "memories"}.`}
      >
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories..."
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading memories...</p>
        ) : records.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query ? "No memories match your search." : "No memories yet. They appear as you chat."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {records.map((record) => (
              <div
                key={record.id}
                className="group flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{record.summary}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {record.canonicalKey ?? "uncategorized"} · {record.scope} · {record.category}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => void removeMemory(record)}
                  aria-label={`Delete memory: ${record.summary}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {records.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void clearAll()}
            >
              Clear all
            </Button>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
