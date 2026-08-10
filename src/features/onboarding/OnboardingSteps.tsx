import {
  AnimatePresence,
  LayoutGroup,
  motion,
} from "motion/react";
import {
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import { type CapabilityMode, type LocalProfile } from "@/store/settingsStore";
import { type ThemeMode } from "@/store/themeStore";
import type { Connection } from "@/generated/bindings/Connection";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import type { Provider } from "@/generated/bindings/Provider";
import { connectionsClient } from "@/features/connections/client";
import { useConnectionsStore } from "@/features/connections/store";
import { getCurrentProviderAccountId } from "@/features/providers";
import { agentStatus, type AgentCliStatus } from "@/features/coding-agents/client";
import { CLAUDE_AGENT, CODEX_AGENT, type AgentConfig } from "@/features/coding-agents/setupCopy";
import { motionDuration, onboardingMotion } from "./motion";
import {
  profileInitials,
  profileLabel,
  PROFILE_NAME_MAX,
  readProfileImage,
} from "./profile";

export type ProviderSummaryItem = {
  label: string;
  detail: string;
};

type IntroProps = {
  title: string;
  description: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  children?: ReactNode;
};

export function StepIntro({ title, description, headingRef, children }: IntroProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start text-left">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-balance font-heading text-[clamp(1.9rem,3vw,2.7rem)] font-medium leading-[1.08] tracking-[-0.03em] text-foreground outline-none"
      >
        {title}
      </h1>
      <p className="mt-3 max-w-lg text-balance text-base leading-relaxed text-muted-foreground">
        {description}
      </p>
      {children}
    </div>
  );
}

export function WelcomeStep({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <StepIntro
      title="Set up PolyUI"
      description="Private by default. A few quick choices, then you’re ready to chat."
      headingRef={headingRef}
    />
  );
}

function ProfilePreview({
  profile,
  name,
  onImageError,
}: {
  profile: LocalProfile;
  name: string;
  onImageError: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = profileLabel(name);
  const showImage = Boolean(profile.avatarUrl) && !imageFailed;

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  return (
    <motion.div layout className="relative size-24 shrink-0 rounded-full ring-1 ring-border">
      <AnimatePresence initial={false} mode="wait">
        {showImage ? (
          <motion.img
            key={profile.avatarUrl}
            src={profile.avatarUrl ?? undefined}
            alt={label}
            onError={() => {
              setImageFailed(true);
              onImageError();
            }}
            initial={{ opacity: 0, scale: onboardingMotion.scale.subtle }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: onboardingMotion.scale.subtle }}
            transition={{ duration: motionDuration("standard", false), ease: onboardingMotion.ease.standard }}
            className="absolute inset-0 size-full rounded-full object-cover"
          />
        ) : (
          <motion.div
            key="initials"
            initial={{ opacity: 0, scale: onboardingMotion.scale.subtle }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: onboardingMotion.scale.subtle }}
            transition={{ duration: motionDuration("standard", false), ease: onboardingMotion.ease.standard }}
            className="absolute inset-0 grid place-items-center rounded-full bg-primary text-2xl font-medium text-primary-foreground"
          >
            {profileInitials(name)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ProfileStep({
  profile,
  setProfile,
  headingRef,
}: {
  profile: LocalProfile;
  setProfile: (profile: LocalProfile) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { user } = useAuthStore(useShallow((state) => ({ user: state.user })));
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const fallbackName = profile.displayName || user?.fullName || "";

  return (
    <StepIntro
      title="Your name"
      description="Choose how you appear in conversations."
      headingRef={headingRef}
    >
      <div className="mt-8 grid w-full gap-6 border-y border-border/60 py-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="flex flex-col items-center gap-3">
          <ProfilePreview
            profile={profile}
            name={fallbackName}
            onImageError={() => setImageError("This image could not be displayed. Choose another one or remove it.")}
          />
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void readProfileImage(file)
                .then((avatarUrl) => {
                  setImageError("");
                  setProfile({ ...profile, avatarUrl });
                })
                .catch((error: unknown) => {
                  setImageError(error instanceof Error ? error.message : "Image could not be used.");
                });
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            Choose image
          </Button>
          {profile.avatarUrl ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setImageError("");
                setProfile({ ...profile, avatarUrl: null });
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor="onboarding-display-name">Display name</Label>
          <Input
            id="onboarding-display-name"
            autoComplete="name"
            value={profile.displayName}
            maxLength={PROFILE_NAME_MAX}
            placeholder="You"
            onChange={(event) => {
              setImageError("");
              setProfile({ ...profile, displayName: event.target.value });
            }}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">Optional. Leave blank to use “You”.</p>
          <AnimatePresence initial={false}>
            {imageError ? (
              <motion.p
                initial={{ opacity: 0, y: -onboardingMotion.distance.small }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -onboardingMotion.distance.small }}
                transition={{ duration: motionDuration("standard", false), ease: onboardingMotion.ease.standard }}
                className="text-sm text-destructive"
                role="alert"
              >
                {imageError}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </StepIntro>
  );
}

type ProviderStatus =
  | "checking"
  | "ready"
  | "not-connected"
  | "not-installed"
  | "sign-in-required"
  | "unavailable"
  | "configuration-required";

type ProviderCardProps = {
  title: string;
  subtitle: string;
  status: ProviderStatus;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
};

const statusText: Record<ProviderStatus, string> = {
  checking: "Checking…",
  ready: "Connected",
  "not-connected": "Not connected",
  "not-installed": "Not installed",
  "sign-in-required": "Sign-in required",
  unavailable: "Unavailable",
  "configuration-required": "Configuration required",
};

function ProviderStatusIcon({ status }: { status: ProviderStatus }) {
  if (status === "checking") return <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />;
  const color = status === "ready"
    ? "bg-success"
    : status === "unavailable"
      ? "bg-warning"
      : "bg-muted-foreground/60";
  return <span className={`size-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

function ProviderCard({
  title,
  subtitle,
  status,
  detail,
  expanded,
  onToggle,
  children,
}: ProviderCardProps) {
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-20 w-full items-center gap-4 py-4 text-left outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">{subtitle}</span>
          <span className="mt-1 flex min-h-5 items-center gap-2 text-xs font-medium text-muted-foreground">
            <ProviderStatusIcon status={status} />
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={status}
                className="inline-flex"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionDuration("standard", false) }}
              >
                {statusText[status]}
              </motion.span>
            </AnimatePresence>
            {detail ? <span className="truncate text-muted-foreground/70">· {detail}</span> : null}
          </span>
        </span>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && children ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: motionDuration("expansion", false), ease: onboardingMotion.ease.enter }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 pb-4 pt-4 text-left">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function connectionReady(summary: ConnectionSummary | undefined): boolean {
  return Boolean(
    summary?.connection.enabled
      && summary.health.status === "ready"
      && summary.enabled_model_count > 0,
  );
}

const API_PROVIDERS: Array<{ provider: Provider; label: string; endpoint: string }> = [
  { provider: "openai", label: "OpenAI", endpoint: "https://api.openai.com/v1" },
  { provider: "anthropic", label: "Anthropic", endpoint: "https://api.anthropic.com/v1" },
  { provider: "openrouter", label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  { provider: "openai-compatible", label: "Compatible API", endpoint: "" },
];

const AGENT_CONFIGS = [CODEX_AGENT, CLAUDE_AGENT] as const;

function makeConnection(
  accountId: string,
  provider: Provider,
  displayName: string,
  baseUrl: string | null,
  existing?: Connection,
): Connection {
  return existing ?? {
    id: crypto.randomUUID(),
    account_id: accountId,
    provider,
    display_name: displayName,
    enabled: true,
    base_url: baseUrl,
    secret_ref: null,
    extra_headers: null,
    position: 0,
  };
}

function SetupMessage({ error, success }: { error: string; success?: string }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {error ? (
        <motion.p
          key="error"
          initial={{ opacity: 0, y: -onboardingMotion.distance.small }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </motion.p>
      ) : success ? (
        <motion.p
          key="success"
          initial={{ opacity: 0, y: -onboardingMotion.distance.small }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-sm text-success"
          role="status"
        >
          {success}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function LocalProviderSetup({
  accountId,
  existing,
  onSaved,
}: {
  accountId: string;
  existing?: ConnectionSummary;
  onSaved: () => Promise<void>;
}) {
  const [endpoint, setEndpoint] = useState(existing?.connection.base_url ?? "http://127.0.0.1:11434");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const connect = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await connectionsClient.save(
        makeConnection(
          accountId,
          "ollama",
          existing?.connection.display_name ?? "Ollama",
          endpoint.trim() || "http://127.0.0.1:11434",
          existing?.connection,
        ),
      );
      await onSaved();
      setSuccess(result.ready ? "Ollama is connected." : result.message);
    } catch {
      setError("Ollama could not be connected. Check that it is running and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2">
        <Label htmlFor="onboarding-ollama-endpoint">Local endpoint</Label>
        <Input
          id="onboarding-ollama-endpoint"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="http://127.0.0.1:11434"
          inputMode="url"
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        PolyUI checks the endpoint and discovers available models before saving it locally.
      </p>
      <div className="flex items-center justify-between gap-3">
        <SetupMessage error={error} success={success} />
        <Button className="ml-auto" size="sm" onClick={() => void connect()} disabled={saving || !endpoint.trim()}>
          {saving ? "Checking…" : "Connect Ollama"}
        </Button>
      </div>
    </div>
  );
}

function ApiProviderSetup({
  accountId,
  existing,
  onSaved,
}: {
  accountId: string;
  existing?: ConnectionSummary;
  onSaved: () => Promise<void>;
}) {
  const existingProvider = existing?.connection.provider;
  const initial = API_PROVIDERS.find((item) => item.provider === existingProvider) ?? API_PROVIDERS[0];
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [endpoint, setEndpoint] = useState(existing?.connection.base_url ?? initial.endpoint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const credentialRef = useRef<HTMLInputElement>(null);
  const selected = API_PROVIDERS.find((item) => item.provider === provider) ?? API_PROVIDERS[0];

  const connect = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const credential = credentialRef.current?.value.trim() ?? "";
      const result = await connectionsClient.save(
        makeConnection(
          accountId,
          provider,
          selected.label,
          endpoint.trim() || selected.endpoint || null,
          existingProvider === provider ? existing?.connection : undefined,
        ),
        credential || undefined,
      );
      if (credentialRef.current) credentialRef.current.value = "";
      await onSaved();
      setSuccess(result.ready ? `${selected.label} is connected.` : result.message);
    } catch {
      setError("This provider could not be connected. Check the endpoint and API key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="onboarding-api-provider">Provider</Label>
          <select
            id="onboarding-api-provider"
            value={provider}
            onChange={(event) => {
              const next = API_PROVIDERS.find((item) => item.provider === event.target.value) ?? API_PROVIDERS[0];
              setProvider(next.provider);
              setEndpoint(next.endpoint);
            }}
            className="h-9 w-full rounded-xl border border-transparent bg-input/50 px-3 text-sm outline-none transition-[border-color,background-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {API_PROVIDERS.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="onboarding-api-endpoint">Endpoint</Label>
          <Input
            id="onboarding-api-endpoint"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={selected.endpoint || "https://your-endpoint.example/v1"}
            inputMode="url"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="onboarding-api-key">API key</Label>
        <Input
          id="onboarding-api-key"
          ref={credentialRef}
          type="password"
          autoComplete="off"
          placeholder={existing?.connection.secret_ref ? "Leave blank to keep the saved key" : "Required for this provider"}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The key is validated and kept in the operating system credential store. It never enters onboarding state.
      </p>
      <div className="flex items-center justify-between gap-3">
        <SetupMessage error={error} success={success} />
        <Button className="ml-auto" size="sm" onClick={() => void connect()} disabled={saving || !endpoint.trim()}>
          {saving ? "Checking…" : "Connect provider"}
        </Button>
      </div>
    </div>
  );
}

function AgentSetup({ agent, onRetry }: { agent: AgentConfig; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        PolyUI uses the installed {agent.displayName} CLI and its existing sign-in. Nothing is uploaded by PolyUI.
      </p>
      <div className="flex items-center justify-between gap-3">
        <Button size="sm" variant="outline" onClick={() => void openUrl(agent.installDocsUrl)}>
          Instructions
        </Button>
        <Button size="sm" onClick={onRetry}>Check again</Button>
      </div>
    </div>
  );
}

function agentStatusView(status: AgentCliStatus | "error" | undefined): ProviderStatus {
  if (!status) return "checking";
  if (status === "error") return "unavailable";
  if (!status.installed) return "not-installed";
  if (!status.authenticated) return "sign-in-required";
  return "ready";
}

export function ProviderStep({
  headingRef,
  onSummaryChange,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSummaryChange: (summary: ProviderSummaryItem[]) => void;
}) {
  const accountId = getCurrentProviderAccountId();
  const { summaries, loading, error: connectionError, actions } = useConnectionsStore(
    useShallow((state) => ({
      summaries: state.summaries,
      loading: state.loading,
      error: state.error,
      actions: state.actions,
    })),
  );
  const [agents, setAgents] = useState<Record<AgentConfig["kind"], AgentCliStatus | "error" | undefined>>({
    codex: undefined,
    "claude-code": undefined,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const previousMeaningfulStatus = useRef<string | null>(null);
  const ollama = summaries.find((item) => item.connection.provider === "ollama");
  const apiConnection = summaries.find((item) =>
    ["openai", "anthropic", "openrouter", "openai-compatible"].includes(item.connection.provider),
  );
  const refreshAgents = async () => {
    setRefreshing(true);
    const results = await Promise.all(
      AGENT_CONFIGS.map(async (agent) => {
        try {
          return [agent.kind, await agentStatus(agent.kind)] as const;
        } catch {
          return [agent.kind, "error" as const] as const;
        }
      }),
    );
    setAgents((current) => ({ ...current, ...Object.fromEntries(results) }));
    setRefreshing(false);
  };

  useEffect(() => {
    if (accountId) void actions.load(accountId);
    void refreshAgents();
    // Detection should start once when the step opens; later health changes
    // update the cards without restarting the step transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const cards = useMemo(() => {
    const ollamaStatus: ProviderStatus = loading
      ? "checking"
      : connectionError
        ? "unavailable"
        : connectionReady(ollama)
          ? "ready"
          : "not-connected";
    const apiStatus: ProviderStatus = loading
      ? "checking"
      : connectionError
        ? "unavailable"
        : connectionReady(apiConnection)
          ? "ready"
          : "configuration-required";
    return [
      {
        id: "ollama",
        title: "Ollama",
        subtitle: "Run local models",
        status: ollamaStatus,
        detail: connectionReady(ollama) ? `${ollama?.enabled_model_count} models` : undefined,
      },
      ...AGENT_CONFIGS.map((agent) => {
        const status = agents[agent.kind];
        return {
          id: agent.kind,
          title: agent.displayName,
          subtitle: agent.kind === "claude-code" ? "Use Claude as a coding agent" : "Use Codex as a coding agent",
          status: agentStatusView(status),
          detail: status && status !== "error" ? status.version : undefined,
        };
      }),
      {
        id: "api",
        title: "API provider",
        subtitle: "Connect OpenAI, Anthropic, OpenRouter, or a compatible API",
        status: apiStatus,
        detail: connectionReady(apiConnection) ? apiConnection?.connection.display_name : undefined,
      },
    ];
  }, [agents, apiConnection, connectionError, loading, ollama]);

  useEffect(() => {
    onSummaryChange(
      cards
        .filter((card) => card.status === "ready")
        .map((card) => ({
          label: card.title,
          detail: card.id === "ollama" ? card.detail ?? "Connected" : card.id === "api" ? "Connected" : "Detected",
        })),
    );
  }, [cards, onSummaryChange]);

  useEffect(() => {
    const meaningfulStatus = cards
      .map((card) => `${card.id}:${card.status === "ready" ? "ready" : card.status}`)
      .join("|");
    if (previousMeaningfulStatus.current === null) {
      previousMeaningfulStatus.current = meaningfulStatus;
      return;
    }
    if (previousMeaningfulStatus.current === meaningfulStatus) return;
    previousMeaningfulStatus.current = meaningfulStatus;
    const ready = cards.filter((card) => card.status === "ready").map((card) => card.title);
    const attention = cards
      .filter((card) => card.status === "unavailable" || card.status === "sign-in-required")
      .map((card) => card.title);
    setStatusAnnouncement(
      ready.length > 0
        ? `${ready.join(", ")} connected.`
        : attention.length > 0
          ? `${attention.join(", ")} need attention.`
          : "Integration status updated.",
    );
  }, [cards]);

  useLayoutEffect(() => {
    document.querySelector<HTMLElement>(".onboarding-step")?.scrollTo({ top: 0, behavior: "auto" });
  }, [expanded]);

  const refreshConnections = async () => {
    if (accountId) await actions.load(accountId);
  };

  return (
    <StepIntro
      title="Connect a model"
      description="Use a local model, coding agent, or API provider."
      headingRef={headingRef}
    >
      <div className="mt-8 w-full max-w-xl border-y border-border/60">
        {cards.map((card) => (
          <ProviderCard
            key={card.id}
            title={card.title}
            subtitle={card.subtitle}
            status={card.status}
            detail={card.detail}
            expanded={expanded === card.id}
            onToggle={() => setExpanded((current) => current === card.id ? null : card.id)}
          >
            {card.id === "ollama" ? (
              <LocalProviderSetup accountId={accountId} existing={ollama} onSaved={refreshConnections} />
            ) : card.id === "api" ? (
              <ApiProviderSetup accountId={accountId} existing={apiConnection} onSaved={refreshConnections} />
            ) : (
              <AgentSetup
                agent={AGENT_CONFIGS.find((agent) => agent.kind === card.id) ?? CODEX_AGENT}
                onRetry={() => void refreshAgents()}
              />
            )}
          </ProviderCard>
        ))}
      </div>
      <div className="mt-4 text-xs text-muted-foreground">
        Optional — you can set this up later.
        {refreshing ? <LoaderCircle className="ml-2 inline-block size-3.5 align-[-2px] motion-safe:animate-spin" aria-hidden="true" /> : null}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{statusAnnouncement}</p>
    </StepIntro>
  );
}

const capabilityOptions: Array<{ id: CapabilityMode; title: string; description: string }> = [
  {
    id: "chat-only",
    title: "Chat only",
    description: "Models can respond without accessing files or commands.",
  },
  {
    id: "workspace",
    title: "Workspace access",
    description: "Models can read and edit files inside folders you approve.",
  },
  {
    id: "agent-tools",
    title: "Agent tools",
    description: "Models can use the sandboxed terminal and complete multi-step work.",
  },
];

function ChoiceCard({
  group,
  title,
  description,
  selected,
  onClick,
}: {
  group: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      layout
      onClick={onClick}
      className="relative flex w-full items-start gap-3 border-b border-border/60 px-1 py-4 text-left outline-none transition-colors last:border-b-0 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {selected ? (
        <motion.span
          layoutId={`${group}-selection`}
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground"
          transition={{ type: "spring", bounce: 0, duration: onboardingMotion.duration.standard }}
        />
      ) : null}
      <span
        className={`relative mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${selected ? "border-foreground" : "border-muted-foreground/50"}`}
        aria-hidden="true"
      >
        {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      <span className="relative flex flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </motion.button>
  );
}

export function CapabilitiesStep({
  capability,
  setCapability,
  headingRef,
}: {
  capability: CapabilityMode;
  setCapability: (mode: CapabilityMode) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <StepIntro
      title="Choose access"
      description="Start safely. You can change this later."
      headingRef={headingRef}
    >
      <LayoutGroup id="onboarding-capabilities">
        <div className="mt-6 flex w-full max-w-xl flex-col" role="radiogroup" aria-label="Model access level">
          {capabilityOptions.map((option) => (
            <ChoiceCard
              key={option.id}
              group="capability"
              {...option}
              selected={capability === option.id}
              onClick={() => setCapability(option.id)}
            />
          ))}
        </div>
      </LayoutGroup>
      <p className="mt-4 max-w-xl text-xs leading-relaxed text-muted-foreground">
        Workspace access stays inside folders you approve. Agent tools use an isolated sandbox.
      </p>
    </StepIntro>
  );
}

const appearanceOptions: Array<{ id: ThemeMode; title: string; description: string }> = [
  { id: "system", title: "System", description: "Follow your operating system." },
  { id: "light", title: "Light", description: "A bright, quiet workspace." },
  { id: "dark", title: "Dark", description: "A focused low-light workspace." },
];

function AppearancePreview() {
  return (
    <div className="mt-5 w-full max-w-xl border-y border-border/60 py-4 text-left">
      <div className="border-b border-border/60 px-1 pb-3">
        <span className="text-xs font-medium text-muted-foreground">Conversation preview</span>
      </div>
      <div className="grid gap-2 px-1 pt-3 sm:grid-cols-[64px_minmax(0,1fr)]">
        <div className="hidden rounded-xl bg-muted sm:block" />
        <div className="flex flex-col gap-2">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-muted/70 px-3 py-1.5 text-xs text-muted-foreground">Good morning. What are we making?</div>
          <div className="ml-auto max-w-[74%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">A calm place to think.</div>
          <div className="h-7 rounded-2xl border border-border/70 bg-background/60" />
        </div>
      </div>
    </div>
  );
}

export function AppearanceStep({
  appearance,
  setAppearance,
  headingRef,
}: {
  appearance: ThemeMode;
  setAppearance: (mode: ThemeMode) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <StepIntro
      title="Choose a look"
      description="You can change this later in Settings."
      headingRef={headingRef}
    >
      <LayoutGroup id="onboarding-appearance">
        <div className="mt-6 flex w-full max-w-xl flex-col" role="radiogroup" aria-label="Appearance">
          {appearanceOptions.map((option) => (
            <ChoiceCard
              key={option.id}
              group="appearance"
              title={option.title}
              description={option.description}
              selected={appearance === option.id}
              onClick={() => setAppearance(option.id)}
            />
          ))}
        </div>
      </LayoutGroup>
      <AppearancePreview />
    </StepIntro>
  );
}

export function ReadyStep({
  profile,
  capability,
  appearance,
  providers,
  headingRef,
}: {
  profile: LocalProfile;
  capability: CapabilityMode;
  appearance: ThemeMode;
  providers: ProviderSummaryItem[];
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const capabilityLabel = capabilityOptions.find((item) => item.id === capability)?.title ?? "Chat only";
  const appearanceLabel = appearanceOptions.find((item) => item.id === appearance)?.title ?? "System";
  return (
    <StepIntro
      title="You’re ready"
      description="Your setup is saved on this device."
      headingRef={headingRef}
    >
      <div className="mt-6 flex w-full max-w-xl flex-col border-y border-border/60 py-4 text-left">
        <div className="flex items-center gap-3 px-1 pb-4">
          <Avatar className="size-11">
            {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={profileLabel(profile.displayName)} /> : null}
            <AvatarFallback seed={profile.displayName}>{profileInitials(profile.displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-medium">{profileLabel(profile.displayName)}</p>
            <p className="text-sm text-muted-foreground">Local profile</p>
          </div>
        </div>
        <div className="grid border-t border-border/60 sm:grid-cols-2">
          {providers.map((provider) => (
            <SummaryItem key={provider.label} label={provider.label} detail={provider.detail} />
          ))}
          <SummaryItem label="Permissions" detail={capabilityLabel} />
          <SummaryItem label="Appearance" detail={appearanceLabel} />
        </div>
      </div>
    </StepIntro>
  );
}

function SummaryItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border/60 px-1 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-medium">{detail}</span>
    </div>
  );
}
