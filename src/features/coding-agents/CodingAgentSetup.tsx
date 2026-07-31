import { useCallback, useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";
import { CodingAgentCard, type CardStatus } from "./CodingAgentCard";
import { agentStatus, type AgentCliStatus } from "./client";
import type { AgentConfig } from "./setupCopy";

export function CodingAgentSetup({ agent, logo }: {
  agent: AgentConfig;
  logo: ReactNode;
}) {
  const [status, setStatus] = useState<AgentCliStatus>();
  const [showHelp, setShowHelp] = useState(false);
  const refresh = useCallback(() => {
    void agentStatus(agent.kind).then(setStatus).catch(() => setStatus({
      installed: false,
      authenticated: false,
    }));
  }, [agent.kind]);

  useEffect(refresh, [refresh]);

  const cardStatus: CardStatus | null = status ? {
    state: !status.installed ? "cli-missing" : status.authenticated ? "ready" : "cli-login-required",
    primaryAction: status.authenticated ? "none" : status.installed ? "sign-in" : "setup",
  } : null;

  return (
    <CodingAgentCard
      agent={agent}
      logo={logo}
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
            <Button size="sm" onClick={refresh}>Retry</Button>
          </div>
        </div>
      ) : null}
    </CodingAgentCard>
  );
}
