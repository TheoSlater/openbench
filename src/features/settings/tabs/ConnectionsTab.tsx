import { useCallback, useEffect, useState } from "react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Collapse } from "@/components/ui/visibility";
import { Dialog } from "@/components/ui/dialog-panel";
import { DialogActions } from "@/components/ui/dialog-panel";
import { DialogContent } from "@/components/ui/dialog-panel";
import { DialogTitle } from "@/components/ui/dialog-panel";
import { Divider } from "@/components/ui/divider";
import { IconButton } from "@/components/ui/icon-button";
import { Paper } from "@/components/ui/Paper";
import { Skeleton } from "@/components/ui/skeleton";
import { Stack } from "@/components/ui/Stack";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { Typography } from "@/components/ui/Typography";
import {
  Brain,
  Cpu,
  Eye,
  EyeOff,
  Gem,
  Globe,
  Plus,
  Route,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SectionHeader, SettingSurface } from "../SettingComponents";
import { useNotify } from "@/hooks/useNotify";
import { useOllama } from "@/features/ollama";
import {
  useProviderStore,
  type ProviderStatus,
  type ProviderStatusResponse,
  type ProviderType,
} from "@/features/providers";
import {
  PROVIDER_PRESETS,
  lookupPreset,
  type ProviderKind,
  type ProviderPreset,
} from "@/features/providers/presets";
import { WebSearchSettings } from "@/features/web-search/WebSearchSettings";
import { cn } from "@/lib/utils";

const statusChipColor: Record<
  ProviderStatus,
  "success" | "error" | "warning" | "default"
> = {
  Online: "success",
  Offline: "error",
  Reconnecting: "warning",
  Unavailable: "default",
};

const presetIcons: Record<string, React.ReactNode> = {
  openai: <Sparkles size={22} />,
  openrouter: <Route size={22} />,
  groq: <Zap size={22} />,
  together: <Globe size={22} />,
  deepseek: <Search size={22} />,
  anthropic: <Brain size={22} />,
  gemini: <Gem size={22} />,
  ollama: <Cpu size={22} />,
  custom: <Settings size={22} />,
};

const KIND_TO_PROVIDER_TYPE: Record<ProviderKind, ProviderType> = {
  "ollama-local": "OllamaLocal",
  "openai-compatible": "OpenAICompatible",
  "anthropic-native": "AnthropicNative",
  "gemini-native": "GeminiNative",
};

const isOllamaLocal = (p: ProviderStatusResponse) =>
  p.provider_type === "OllamaLocal";

function ProviderCard({
  provider,
  updateProviderConfig,
  onDelete,
}: {
  provider: ProviderStatusResponse;
  updateProviderConfig: (config: {
    id: number;
    provider_type: ProviderType;
    enabled?: boolean;
    ollama_host?: string;
    api_key?: string;
    api_base_url?: string;
  }) => Promise<void>;
  onDelete?: () => void;
}) {
  const notify = useNotify();
  const ollama = useOllama();
  const isOllama = isOllamaLocal(provider);

  const preset = lookupPreset(
    isOllama ? "ollama" : (provider.config.preset ?? null),
    isOllama
      ? (provider.config.ollama_host ?? "")
      : (provider.config.api_base_url ?? null),
  );
  const url = isOllama
    ? (provider.config.ollama_host ?? "http://127.0.0.1:11434")
    : (provider.config.api_base_url ?? "");

  const [editing, setEditing] = useState(false);
  const [host, setHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const openEdit = () => {
    setHost(isOllama
      ? (provider.config.ollama_host ?? "http://127.0.0.1:11434")
      : (provider.config.api_base_url ?? ""));
    setApiKey(provider.config.api_key ?? "");
    setEnabled(provider.config.enabled);
    setDirty(false);
    setEditing(true);
  };

  const closeEdit = () => {
    setEditing(false);
    setDirty(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (isOllama) {
        await updateProviderConfig({
          id: provider.config.id,
          provider_type: "OllamaLocal",
          ollama_host: host.trim(),
          enabled,
        });
      } else {
        await updateProviderConfig({
          id: provider.config.id,
          provider_type: provider.config.provider_type,
          api_base_url: host.trim(),
          api_key: apiKey.trim() || undefined,
          enabled,
        });
        ollama.actions.clearExternalModels();
        await ollama.refresh();
      }
      setDirty(false);
      setEditing(false);
      notify.success("Connection saved");
    } catch (err) {
      notify.error("Failed to save", String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <SettingSurface>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
        >
          <Typography variant="body1">
            {preset.label}
          </Typography>
          <Chip
            label={provider.status}
            color={statusChipColor[provider.status]}
            size="small"
          />
          <Box />
          {editing ? (
            <IconButton size="small" aria-label="Close edit" onClick={closeEdit}>
              <X size={15} />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              aria-label={`Edit ${preset.label}`}
              onClick={openEdit}
            >
              <Settings size={15} />
            </IconButton>
          )}
          {!isOllama && onDelete && (
            <IconButton
              size="small"
              aria-label={`Delete ${preset.label}`}
              onClick={onDelete}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </Stack>

        {!editing && (
          <Typography variant="caption" color="text.secondary">
            {url}
          </Typography>
        )}

        <Collapse in={editing}>
          <Stack spacing={1}>
            {isOllama ? (
              <TextField
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setDirty(true);
                }}
                placeholder="http://127.0.0.1:11434"
                fullWidth
                size="small"
              />
            ) : (
              <TextField
                label="API base URL"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setDirty(true);
                }}
                placeholder="https://api.openai.com/v1"
                fullWidth
                size="small"
              />
            )}
            {!isOllama && (
              <TextField
                label="API key (optional)"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setDirty(true);
                }}
                placeholder={preset.requiresApiKey ? "sk-..." : "Optional"}
                type={showKey ? "text" : "password"}
                autoComplete="off"
                fullWidth
                size="small"
                slotProps={{
                  input: {
                    endAdornment: (
                      <IconButton
                        size="small"
                        aria-label={showKey ? "Hide API key" : "Show API key"}
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </IconButton>
                    ),
                  },
                }}
              />
            )}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Enabled
              </Typography>
              <Switch
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              <Box />
              <Button
                size="small"
                variant="outlined"
                disabled={!dirty || saving || !host.trim()}
                onClick={save}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </Stack>
          </Stack>
        </Collapse>
      </SettingSurface>
    </Box>
  );
}

export function ConnectionsTab() {
  const notify = useNotify();
  const { providers, loading, error, actions } = useProviderStore(
    useShallow((state) => ({
      providers: state.providers,
      loading: state.loading,
      error: state.error,
      actions: state.actions,
    })),
  );
  const ollama = useOllama();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
  const [addApiBaseUrl, setAddApiBaseUrl] = useState("");
  const [addApiKey, setAddApiKey] = useState("");
  const [showAddKey, setShowAddKey] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);

  useEffect(() => void actions.refresh(), [actions]);

  const selectPreset = (preset: ProviderPreset) => {
    setSelectedPreset(preset);
    setAddApiBaseUrl(preset.baseUrl);
    setAddApiKey("");
  };

  const saveAdd = async () => {
    if (!selectedPreset) return;
    const isOllamaPreset = selectedPreset.kind === "ollama-local";
    const url = isOllamaPreset
      ? addApiBaseUrl.trim() || "http://127.0.0.1:11434"
      : addApiBaseUrl.trim();
    if (!url) return;
    setAddingProvider(true);
    try {
      if (isOllamaPreset) {
        await actions.addProvider({
          provider_type: "OllamaLocal",
          enabled: true,
          ollama_host: url,
          preset: selectedPreset.id,
          headers: selectedPreset.defaultHeaders
            ? JSON.stringify(selectedPreset.defaultHeaders)
            : undefined,
          model_suggestions: selectedPreset.modelSuggestions
            ? JSON.stringify(selectedPreset.modelSuggestions)
            : undefined,
        });
      } else {
        await actions.addProvider({
          provider_type: KIND_TO_PROVIDER_TYPE[selectedPreset.kind],
          enabled: true,
          api_base_url: url,
          api_key: addApiKey.trim() || undefined,
          preset: selectedPreset.id,
          headers: selectedPreset.defaultHeaders
            ? JSON.stringify(selectedPreset.defaultHeaders)
            : undefined,
          model_suggestions: selectedPreset.modelSuggestions
            ? JSON.stringify(selectedPreset.modelSuggestions)
            : undefined,
        });
        ollama.actions.clearExternalModels();
        await ollama.refresh();
      }
      setAddOpen(false);
      setSelectedPreset(null);
      setAddApiBaseUrl("");
      setAddApiKey("");
      notify.success("Connection added");
    } catch (err) {
      notify.error("Failed to add connection", String(err));
    } finally {
      setAddingProvider(false);
    }
  };

  const handleCloseAdd = () => {
    setAddOpen(false);
    setSelectedPreset(null);
    setAddApiBaseUrl("");
    setAddApiKey("");
  };

  const [deleteTarget, setDeleteTarget] = useState<ProviderStatusResponse | null>(null);

  const deleteProvider = useCallback(
    async (provider: ProviderStatusResponse) => {
      try {
        await actions.deleteProvider(provider.config.id);
        notify.success("Connection deleted");
      } catch (err) {
        notify.error("Failed to delete", String(err));
      }
    },
    [actions, notify],
  );

  return (
    <Stack spacing={2}>
      <SectionHeader
        title="LLM Providers"
        description="Connect local or cloud model providers."
        action={
          <Button
            size="small"
            variant="contained"
            startIcon={<Plus size={15} />}
            onClick={() => setAddOpen(true)}
          >
            Add LLM
          </Button>
        }
      />

      {loading && providers.length === 0 && (
        <Box>
          <SettingSurface>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
            >
              <Skeleton variant="text" width={60} height={24} />
              <Skeleton variant="rounded" width={70} height={24} />
              <Box />
              <Skeleton variant="circular" width={28} height={28} />
            </Stack>
            <Skeleton variant="text" width={180} height={18} />
          </SettingSurface>
        </Box>
      )}
      {error && providers.length === 0 && (
        <Typography>
          Connection error: {String(error)}
        </Typography>
      )}

      {providers.map((provider) => {
        const key = provider.config.id;
        return (
          <ProviderCard
            key={key}
            provider={provider}
            updateProviderConfig={actions.updateProviderConfig}
            onDelete={
              isOllamaLocal(provider) ? undefined : () => setDeleteTarget(provider)
            }
          />
        );
      })}

      <Divider />

      <SectionHeader
        title="Web Search API Keys"
        description="API keys for live web search during chat."
        className="mt-8"
      />
      <WebSearchSettings />

      <Dialog open={addOpen} onClose={handleCloseAdd} maxWidth="sm" fullWidth>
        <DialogTitle
          className="flex items-center justify-between gap-3"
        >
          Add LLM Connection
          <IconButton size="small" aria-label="Close" onClick={handleCloseAdd}>
            <X size={18} />
          </IconButton>
        </DialogTitle>
        <DialogContent className="flex flex-col gap-4">
          <Typography className="text-sm text-muted-foreground">
            Pick a provider preset or configure a custom connection.
          </Typography>

          <Box
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {PROVIDER_PRESETS.map((preset) => {
              const selected = selectedPreset?.id === preset.id;
              return (
                <Paper
                  key={preset.id}
                  variant="outlined"
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border-border/70 bg-background/40 p-3 transition-colors hover:bg-muted/60",
                    selected && "border-primary bg-primary/10",
                  )}
                  onClick={() => selectPreset(preset)}
                >
                  <Box
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                  >
                    {presetIcons[preset.id] ?? <Settings size={22} />}
                  </Box>
                  <Typography
                    variant="body2"
                    className="font-medium"
                  >
                    {preset.label}
                  </Typography>
                </Paper>
              );
            })}
          </Box>

          {selectedPreset && (
            <Stack spacing={2}>
              <Divider />
              <Typography>
                {selectedPreset.label}
              </Typography>

              {selectedPreset.kind === "ollama-local" ? (
                <TextField
                  label="Host"
                  value={addApiBaseUrl}
                  onChange={(e) => setAddApiBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  fullWidth
                  size="small"
                />
              ) : (
                <>
                  <TextField
                    label="API base URL"
                    value={addApiBaseUrl}
                    onChange={(e) => setAddApiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    required
                    fullWidth
                    size="small"
                  />
                  {selectedPreset.requiresApiKey && (
                    <TextField
                      label="API key"
                      value={addApiKey}
                      onChange={(e) => setAddApiKey(e.target.value)}
                      placeholder="sk-..."
                      type={showAddKey ? "text" : "password"}
                      autoComplete="off"
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          endAdornment: (
                            <IconButton
                              size="small"
                              aria-label={showAddKey ? "Hide API key" : "Show API key"}
                              onClick={() => setShowAddKey(!showAddKey)}
                            >
                              {showAddKey ? <EyeOff size={15} /> : <Eye size={15} />}
                            </IconButton>
                          ),
                        },
                      }}
                    />
                  )}
                  {selectedPreset.modelSuggestions &&
                    selectedPreset.modelSuggestions.length > 0 && (
                      <Typography>
                        Suggested models: {selectedPreset.modelSuggestions.join(", ")}
                      </Typography>
                    )}
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAdd}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disableElevation
            disabled={!selectedPreset || !addApiBaseUrl.trim() || addingProvider}
            onClick={saveAdd}
          >
            {addingProvider ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete connection?"
        description={
          deleteTarget
            ? `Delete "${lookupPreset(deleteTarget.config.preset, deleteTarget.config.api_base_url ?? null).label}" connection?`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void deleteProvider(deleteTarget);
        }}
      />
    </Stack>
  );
}
