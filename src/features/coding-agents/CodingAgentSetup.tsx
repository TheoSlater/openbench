import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";
import { CodingAgentCard, type CardStatus } from "./CodingAgentCard";
import type { AgentConfig } from "./setupCopy";
import { useRuntimeCatalogStore } from "@/features/runtime/catalog-store";

export function CodingAgentSetup({ agent }: {
  agent: AgentConfig;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const entry = useRuntimeCatalogStore((state) => state.agents[agent.kind]);
  const refreshAgent = useRuntimeCatalogStore((state) => state.actions.refreshAgent);
  const status = entry.status;

  const cardStatus: CardStatus | null = entry.statusState === "loading" || entry.statusState === "idle"
    ? null
    : status
      ? {
        state: !status.installed ? "cli-missing" : status.authenticated ? "ready" : "cli-login-required",
        primaryAction: status.authenticated ? "none" : status.installed ? "sign-in" : "setup",
      }
      : { state: "failed", primaryAction: "retry", diagnostic: entry.error ?? undefined };

  return (
    <CodingAgentCard
      agent={agent}
      status={cardStatus}
      onOpenSetup={() => setShowHelp(true)}
    >
      {showHelp ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <Typography variant="caption" color="secondary">
            Install and sign in with the {agent.displayName} CLI, then retry.
          </Typography>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void openUrl(agent.installDocsUrl)}>
              Instructions
            </Button>
            <Button size="sm" onClick={() => void refreshAgent(agent.kind)}>Retry</Button>
          </div>
        </div>
      ) : null}
    </CodingAgentCard>
  );
}
