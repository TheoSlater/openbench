import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";
import { adapterInstallPlan, installAdapter } from "@/features/acp/adapter-install-client";
import type { AdapterInstallPlan } from "@/generated/bindings/AdapterInstallPlan";
import type { PrimaryAction } from "@/generated/bindings/PrimaryAction";
import { CodingAgentCard, type CardStatus } from "./CodingAgentCard";
import type { AgentConfig } from "./setupCopy";

type SetupState =
  | { state: "unknown" }
  | { state: "not-installed"; reason: string | null }
  | { state: "needs-initialize"; adapter_path: string }
  | { state: "authentication-required"; adapter_path: string }
  | { state: "cli-login-required"; adapter_path: string }
  | { state: "config-invalid"; adapter_path: string; diagnostic: string }
  | { state: "cli-missing"; reason: string | null }
  | { state: "adapter-missing"; reason: string | null }
  | { state: "adapter-outdated"; adapter_path: string; version: string | null }
  | { state: "ready"; adapter_path: string }
  | { state: "crashed"; adapter_path: string | null; message: string };

export type AnySetupView = {
  state: SetupState;
  primary_action: PrimaryAction;
  usable: boolean;
};

type Phase =
  | { kind: "checking" | "starting" | "signing-in" | "ready" }
  | {
    kind: "install";
    plan: AdapterInstallPlan | null;
    error: string | null;
    busy: boolean;
    replacing: boolean;
  }
  | { kind: "cli"; error?: string }
  | { kind: "error"; message: string };

type Props<Settings> = {
  agent: AgentConfig;
  logo: ReactNode;
  settings: Settings;
  status: (settings: Settings) => Promise<AnySetupView>;
  verify: (settings: Settings) => Promise<AnySetupView>;
  authenticate: (settings: Settings) => Promise<AnySetupView>;
  cancelAuthenticate: () => Promise<void>;
};

export function CodingAgentSetup<Settings>({
  agent,
  logo,
  settings,
  status,
  verify,
  authenticate,
  cancelAuthenticate,
}: Props<Settings>) {
  const [view, setView] = useState<AnySetupView | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const authCancelled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const cached = await status(settings);
      setView(cached);
      if (cached.state.state === "unknown") {
        setView(await verify(settings));
      }
    } catch (error) {
      console.warn(`[${agent.kind}] status failed`, error);
    }
  }, [agent.kind, settings, status, verify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (phase?.kind !== "ready") return;
    const timer = window.setTimeout(() => setPhase(null), 900);
    return () => window.clearTimeout(timer);
  }, [phase?.kind]);

  const accept = useCallback((result: AnySetupView) => {
    setView(result);
    if (result.state.state === "ready") setPhase({ kind: "ready" });
    else if (result.state.state === "cli-login-required") setPhase({ kind: "cli" });
    else if (result.state.state === "config-invalid") setPhase(null);
    else if (result.state.state === "crashed") {
      setPhase({ kind: "error", message: result.state.message });
    } else {
      setPhase(null);
    }
  }, []);

  const runVerify = useCallback(async () => {
    setPhase({ kind: "starting" });
    try {
      accept(await verify(settings));
    } catch (error) {
      setPhase({ kind: "error", message: String(error) });
    }
  }, [accept, settings, verify]);

  const prepareInstall = useCallback(async (replacing: boolean) => {
    setPhase({ kind: "checking" });
    try {
      const plan = await adapterInstallPlan(agent.kind);
      setPhase({ kind: "install", plan, error: null, busy: false, replacing });
    } catch (error) {
      setPhase({ kind: "install", plan: null, error: String(error), busy: false, replacing });
    }
  }, [agent.kind]);

  const act = useCallback(async () => {
    if (!view) return;
    if (view.primary_action === "sign-in") {
      authCancelled.current = false;
      setPhase({ kind: "signing-in" });
      try {
        const result = await authenticate(settings);
        if (!authCancelled.current) accept(result);
      } catch (error) {
        if (!authCancelled.current) setPhase({ kind: "error", message: String(error) });
      }
      return;
    }
    if (view.state.state === "cli-missing" || view.state.state === "not-installed") {
      setPhase({ kind: "cli" });
      return;
    }
    if (
      view.state.state === "adapter-missing"
      || view.state.state === "adapter-outdated"
    ) {
      await prepareInstall(view.state.state === "adapter-outdated");
      return;
    }
    await runVerify();
  }, [accept, authenticate, prepareInstall, runVerify, settings, view]);

  const confirmInstall = useCallback(async () => {
    if (phase?.kind !== "install" || !phase.plan) return;
    setPhase({ ...phase, busy: true });
    try {
      await installAdapter(agent.kind);
      await runVerify();
    } catch (error) {
      setPhase({
        kind: "install",
        plan: phase.plan,
        error: String(error),
        busy: false,
        replacing: phase.replacing,
      });
    }
  }, [agent.kind, phase, runVerify]);

  const cardStatus: CardStatus | null = view && view.state.state !== "unknown" ? {
    primaryAction: view.primary_action,
    state: view.state.state,
    diagnostic: view.state.state === "crashed"
      ? view.state.message
      : view.state.state === "config-invalid"
        ? view.state.diagnostic
        : undefined,
  } : null;

  return (
    <CodingAgentCard
      agent={agent}
      logo={logo}
      status={cardStatus}
      onOpenSetup={() => void act()}
    >
      {phase ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          {phase.kind === "checking" ? <Busy label="Checking" /> : null}
          {phase.kind === "starting" ? <Busy label="Starting" /> : null}
          {phase.kind === "signing-in" ? (
            <div className="flex items-center justify-between gap-3">
              <Busy label="Signing in" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  authCancelled.current = true;
                  setPhase(null);
                  void cancelAuthenticate();
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}
          {phase.kind === "ready" ? (
            <Typography variant="caption" color="secondary">Ready</Typography>
          ) : null}
          {phase.kind === "cli" ? (
            <div className="flex items-center justify-between gap-3">
              <Typography variant="caption" color="secondary">
                Install or sign in with the {agent.displayName} CLI, then retry.
              </Typography>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openUrl(agent.installDocsUrl)}
              >
                Instructions
              </Button>
            </div>
          ) : null}
          {phase.kind === "install" ? (
            <div className="flex flex-col gap-2">
              <Typography variant="caption" color="secondary">
                {phase.replacing ? "Replace outdated " : "Install "}
                {phase.plan?.package ?? "adapter"}
              </Typography>
              {phase.plan ? (
                <code className="overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 text-xs">
                  {phase.plan.command}
                </code>
              ) : null}
              {phase.error ? (
                <Typography variant="caption" color="error">{phase.error}</Typography>
              ) : null}
              <Button
                size="sm"
                disabled={!phase.plan || phase.busy}
                onClick={() => void confirmInstall()}
              >
                {phase.busy ? "Installing…" : phase.replacing ? "Replace" : "Install"}
              </Button>
            </div>
          ) : null}
          {phase.kind === "error" ? (
            <div className="flex items-center justify-between gap-3">
              <Typography variant="caption" color="error">{phase.message}</Typography>
              <Button size="sm" variant="outline" onClick={() => void act()}>Retry</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </CodingAgentCard>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}
