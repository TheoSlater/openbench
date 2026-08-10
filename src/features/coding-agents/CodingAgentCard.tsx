import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { Typography } from "@/components/ui/Typography";
import { cardStatus } from "@/features/connections/status";
import { AgentIcon } from "./AgentIcon";
import { CARD_STATUS, type AgentConfig } from "./setupCopy";

/** The only two fields the card needs, agent-agnostic by construction. */
export type CardStatus = {
  primaryAction: "none" | "setup" | "sign-in" | "retry";
  state: string;
  diagnostic?: string;
};

type Props = {
  agent: AgentConfig;
  /** `null` means detection hasn't resolved yet — the card shows a skeleton. */
  status: CardStatus | null;
  onOpenSetup: () => void;
  children?: ReactNode;
};

export function CodingAgentCard({ agent, status, onOpenSetup, children }: Props) {
  return (
    <Card className="w-full border-primary/20 bg-primary/[0.025] p-4 shadow-none">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentIcon kind={agent.kind} className="size-5" />
          <Typography variant="body2" weight="medium">
            {agent.displayName}
          </Typography>
        </div>
        <div className="shrink-0">
          {status === null ? (
            <Skeleton className="h-6 w-20" />
          ) : status.state === "config-invalid" ? (
            <Tooltip title={status.diagnostic}>
              <span className="text-xs font-medium text-warning">
                {cardStatus("config-invalid")}
              </span>
            </Tooltip>
          ) : status.primaryAction === "none" ? (
            <Badge
              variant="secondary"
              className="text-[0.6875rem] font-semibold tracking-wide text-success"
            >
              {cardStatus("ready")?.toUpperCase()}
            </Badge>
          ) : status.primaryAction === "sign-in" ? (
            <Button size="sm" variant="outline" onClick={onOpenSetup}>
              {CARD_STATUS.signIn}
            </Button>
          ) : status.primaryAction === "retry" ? (
            <Tooltip title={status.diagnostic}>
              <Button size="sm" variant="outline" onClick={onOpenSetup}>
                {CARD_STATUS.retry}
              </Button>
            </Tooltip>
          ) : (
            <Button size="sm" onClick={onOpenSetup}>
              {CARD_STATUS.setUp}
            </Button>
          )}
        </div>
      </div>
      {children}
    </Card>
  );
}
