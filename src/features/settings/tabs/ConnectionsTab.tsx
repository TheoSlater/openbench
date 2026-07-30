import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  claudeAuthenticate,
  claudeCancelAuthenticate,
  claudeStatus,
  claudeVerify,
} from "@/features/claude/claudeClient";
import {
  codexAuthenticate,
  codexCancelAuthenticate,
  codexStatus,
  codexVerify,
} from "@/features/codex/codexClient";
import { CodingAgentSetup } from "@/features/coding-agents/CodingAgentSetup";
import { CLAUDE_AGENT, CODEX_AGENT } from "@/features/coding-agents/setupCopy";
import { connectionsClient } from "@/features/connections/client";
import { groupConnections, safeEndpointSummary } from "@/features/connections/presentation";
import { cardStatus } from "@/features/connections/status";
import { useConnectionsStore } from "@/features/connections/store";
import { getCurrentProviderAccountId } from "@/features/providers";
import type { Connection } from "@/generated/bindings/Connection";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import type { Provider } from "@/generated/bindings/Provider";
import { useNotify } from "@/hooks/useNotify";
import { useSettingsStore } from "@/store/settingsStore";

const PROVIDERS: Array<{ provider: Provider; label: string; endpoint: string }> = [
  { provider: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1" },
  { provider: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1" },
  { provider: "gemini", label: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta" },
  { provider: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  { provider: "ollama", label: "Ollama", endpoint: "http://127.0.0.1:11434" },
  { provider: "lmstudio", label: "LM Studio", endpoint: "http://127.0.0.1:1234/v1" },
  { provider: "openai-compatible", label: "Custom endpoint", endpoint: "" },
];

const labelFor = (provider: Provider) =>
  PROVIDERS.find((item) => item.provider === provider)?.label ?? provider;

function ConnectionEditor({
  open,
  initial,
  onOpenChange,
  onSaved,
  persisted = false,
}: {
  open: boolean;
  initial: Connection;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  persisted?: boolean;
}) {
  const [connection, setConnection] = useState(initial);
  const [credential, setCredential] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ConnectionModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const notify = useNotify();

  useEffect(() => {
    if (open) {
      setConnection(initial);
      setCredential("");
      setModelId("");
      if (persisted) {
        void connectionsClient.models(initial.id).then(setModels).catch(() => setModels([]));
      }
    }
  }, [initial, open, persisted]);

  const save = async () => {
    setSaving(true);
    try {
      await connectionsClient.save(connection, credential);
      await onSaved();
      onOpenChange(false);
      notify.success("Connection saved");
    } catch (error) {
      notify.error("Connection failed", String(error));
    } finally {
      setSaving(false);
    }
  };

  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      setModels(await connectionsClient.refreshModels(initial.id));
    } catch (error) {
      notify.error("Model refresh failed", String(error));
    } finally {
      setLoadingModels(false);
    }
  };

  const addModel = async () => {
    const remoteId = modelId.trim();
    if (!remoteId) return;
    try {
      await connectionsClient.saveManualModel(initial.id, remoteId);
      setModels(await connectionsClient.models(initial.id));
      setModelId("");
    } catch (error) {
      notify.error("Model could not be added", String(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial.id ? `Configure ${initial.display_name}` : "Add connection"}</DialogTitle>
          <DialogDescription>Validation runs before settings are saved.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="connection-name">Name</Label>
            <Input
              id="connection-name"
              value={connection.display_name}
              onChange={(event) => setConnection({ ...connection, display_name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="connection-endpoint">Endpoint</Label>
            <Input
              id="connection-endpoint"
              value={connection.base_url ?? ""}
              placeholder="Use provider default"
              onChange={(event) => setConnection({ ...connection, base_url: event.target.value || null })}
            />
          </div>
          {!["ollama", "lmstudio"].includes(connection.provider) ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="connection-key">API key</Label>
              <Input
                id="connection-key"
                type="password"
                autoComplete="off"
                value={credential}
                placeholder={connection.secret_ref ? "Leave blank to keep existing key" : "Required"}
                onChange={(event) => setCredential(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="connection-enabled">Enabled</Label>
            <Switch
              id="connection-enabled"
              checked={connection.enabled}
              onCheckedChange={(enabled) => setConnection({ ...connection, enabled })}
            />
          </div>
          {persisted ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Models</Label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingModels}
                  onClick={() => void refreshModels()}
                >
                  <RefreshCw className={loadingModels ? "animate-spin" : undefined} />
                  Refresh
                </Button>
              </div>
              <div className="max-h-28 overflow-y-auto rounded-md border p-2 text-xs text-muted-foreground">
                {models.length
                  ? models.map((model) => (
                    <div key={model.remote_id} className="flex items-center justify-between gap-3 py-1">
                      <span className="truncate">{model.display_name ?? model.remote_id}</span>
                      <Switch
                        aria-label={`Enable ${model.display_name ?? model.remote_id}`}
                        checked={model.enabled}
                        onCheckedChange={(enabled) => {
                          setModels((current) => current.map((item) => (
                            item.remote_id === model.remote_id ? { ...item, enabled } : item
                          )));
                          void connectionsClient
                            .setModelEnabled(initial.id, model.remote_id, enabled)
                            .catch((error) => notify.error("Model update failed", String(error)));
                        }}
                      />
                    </div>
                  ))
                  : "No configured models."}
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Manual model ID"
                  value={modelId}
                  placeholder="Manual model ID"
                  onChange={(event) => setModelId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addModel();
                    }
                  }}
                />
                <Button variant="outline" disabled={!modelId.trim()} onClick={() => void addModel()}>
                  Add
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving || !connection.display_name.trim()}
            onClick={() => void save()}
          >
            {saving ? "Testing…" : "Test and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderConnectionCard({
  summary,
  accountId,
}: {
  summary: ConnectionSummary;
  accountId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const notify = useNotify();
  const { load, remove } = useConnectionsStore((state) => state.actions);
  const { connection, health } = summary;
  const status = !connection.enabled
    ? "disabled"
    : health.status === "ready"
      ? "ready"
      : health.status === "failed"
        ? "failed"
        : "unvalidated";

  const test = async () => {
    setTesting(true);
    try {
      const result = await connectionsClient.validate(connection.id);
      notify.success("Connection ready", result.message);
    } catch (error) {
      notify.error("Connection failed", String(error));
    } finally {
      await load(accountId);
      setTesting(false);
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">{connection.display_name}</CardTitle>
            <CardDescription>{labelFor(connection.provider)} · {safeEndpointSummary(connection)}</CardDescription>
          </div>
          <Badge variant={status === "failed" ? "destructive" : "secondary"}>
            {cardStatus(status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-4">
        <div className="min-w-0 text-xs text-muted-foreground">
          <div>{summary.available_model_count} available · {summary.enabled_model_count} enabled</div>
          {health.last_validated_at ? (
            <div className="truncate">
              Validated {new Date(health.last_validated_at).toLocaleString()}
            </div>
          ) : null}
          {health.status === "failed" && health.detail ? (
            <div className="mt-1 line-clamp-2 text-destructive">{health.detail}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon-sm" variant="ghost" aria-label={`Configure ${connection.display_name}`} onClick={() => setEditing(true)}>
            <Settings2 />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={`Test ${connection.display_name}`} disabled={testing} onClick={() => void test()}>
            <RefreshCw className={testing ? "animate-spin" : undefined} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove ${connection.display_name}`}
            onClick={() => void remove(accountId, connection.id)}
          >
            <Trash2 />
          </Button>
        </div>
      </CardContent>
      <ConnectionEditor
        open={editing}
        initial={connection}
        onOpenChange={setEditing}
        onSaved={() => load(accountId)}
        persisted
      />
    </Card>
  );
}

function ConnectionSection({
  title,
  items,
  accountId,
}: {
  title: string;
  items: ConnectionSummary[];
  accountId: string;
}) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="grid gap-2 xl:grid-cols-2">
        {items.map((item) => (
          <ProviderConnectionCard key={item.connection.id} summary={item} accountId={accountId} />
        ))}
      </div>
    </section>
  );
}

export function ConnectionsTab() {
  const accountId = getCurrentProviderAccountId();
  const { summaries, loading, error, actions } = useConnectionsStore(
    useShallow((state) => ({
      summaries: state.summaries,
      loading: state.loading,
      error: state.error,
      actions: state.actions,
    })),
  );
  const settings = useSettingsStore(
    useShallow((state) => ({
      codex: state.codex,
      claude: state.claude,
    })),
  );
  const [adding, setAdding] = useState<Connection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const grouped = useMemo(() => groupConnections(summaries), [summaries]);

  useEffect(() => {
    if (accountId) void actions.load(accountId);
  }, [accountId, actions]);

  const beginAdd = (provider: Provider) => {
    const preset = PROVIDERS.find((item) => item.provider === provider)!;
    setAdding({
      id: crypto.randomUUID(),
      account_id: accountId,
      provider,
      display_name: preset.label,
      enabled: true,
      base_url: preset.endpoint || null,
      secret_ref: null,
      extra_headers: null,
      position: summaries.length,
    });
    setPickerOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">Coding agents</h2>
          <p className="text-sm text-muted-foreground">External ACP runtimes own tools, files, and terminal work.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <CodingAgentSetup
            agent={CODEX_AGENT}
            logo="⬡"
            settings={settings.codex}
            status={codexStatus}
            verify={codexVerify}
            authenticate={codexAuthenticate}
            cancelAuthenticate={codexCancelAuthenticate}
          />
          <CodingAgentSetup
            agent={CLAUDE_AGENT}
            logo="✳"
            settings={settings.claude}
            status={claudeStatus}
            verify={claudeVerify}
            authenticate={claudeAuthenticate}
            cancelAuthenticate={claudeCancelAuthenticate}
          />
        </div>
      </section>

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Model connections</h2>
          <p className="text-sm text-muted-foreground">Keys stay in OS credential storage.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
          <Plus data-icon="inline-start" />
          Add connection
        </Button>
      </div>

      {loading && !summaries.length ? (
        <div className="grid gap-2 xl:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Connections unavailable</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void actions.load(accountId)}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!loading && !error && !summaries.length ? (
        <p className="text-sm text-muted-foreground">
          Add a cloud, local, or custom model connection.
        </p>
      ) : null}

      <ConnectionSection title="Cloud providers" items={grouped.cloud} accountId={accountId} />
      <ConnectionSection title="Local providers" items={grouped.local} accountId={accountId} />
      <ConnectionSection title="Custom endpoints" items={grouped.custom} accountId={accountId} />

      {adding ? (
        <ConnectionEditor
          open
          initial={adding}
          onOpenChange={(open) => !open && setAdding(null)}
          onSaved={() => actions.load(accountId)}
        />
      ) : null}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add connection</DialogTitle>
            <DialogDescription>Choose where Poly should run chat models.</DialogDescription>
          </DialogHeader>
          {[
            ["Cloud", PROVIDERS.filter((item) => ["openai", "anthropic", "gemini", "openrouter"].includes(item.provider))],
            ["Local", PROVIDERS.filter((item) => ["ollama", "lmstudio"].includes(item.provider))],
            ["Custom", PROVIDERS.filter((item) => item.provider === "openai-compatible")],
          ].map(([title, providers]) => (
            <section key={title as string} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">{title as string}</h3>
              <div className="grid grid-cols-2 gap-2">
                {(providers as typeof PROVIDERS).map((item) => (
                  <Button
                    key={item.provider}
                    variant="outline"
                    className="justify-start"
                    onClick={() => beginAdd(item.provider)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
