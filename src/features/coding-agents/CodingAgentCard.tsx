import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { Typography } from "@/components/ui/Typography";
import type { PrimaryAction } from "@/generated/bindings/PrimaryAction";
import { cardStatus } from "@/features/connections/status";
import { CARD_STATUS, type AgentConfig } from "./setupCopy";

/** The only two fields the card needs, agent-agnostic by construction. */
export type CardStatus = {
  primaryAction: PrimaryAction;
  state: string;
  diagnostic?: string;
};

type Props = {
  agent: AgentConfig;
  logo: ReactNode;
  /** `null` means detection hasn't resolved yet — the card shows a skeleton. */
  status: CardStatus | null;
  onOpenSetup: () => void;
  children?: ReactNode;
};

/**
 * A coding agent is either usable or it is not — that is the whole surface.
 * Logo mark, name, and one status element underneath. Nothing else: no
 * version, no workspace, no capability chips, no adapter source.
 *
 * Fixed dimensions in every state so the card never resizes when its status
 * changes — the height below is deliberately not content-driven.
 */
export function CodingAgentCard({ agent, logo, status, onOpenSetup, children }: Props) {
  return (
    <Card className="w-full border-primary/20 bg-primary/[0.025] p-4 shadow-none">
      <div className="flex h-[72px] flex-col justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg leading-none">
            {logo}
          </span>
          <Typography variant="body2" weight="medium">
            {agent.displayName}
          </Typography>
        </div>
        <div>
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
