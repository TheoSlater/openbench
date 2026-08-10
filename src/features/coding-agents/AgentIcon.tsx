import type { AgentKind } from "@/generated/bindings/AgentKind";
import { cn } from "@/lib/utils";

const ICONS: Record<AgentKind, string> = {
  codex: "/icons/codex.svg",
  "claude-code": "/icons/claude.svg",
};

export function AgentIcon({ kind, className }: { kind: AgentKind; className?: string }) {
  const mask = `url("${ICONS[kind]}") center / contain no-repeat`;

  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ mask, WebkitMask: mask }}
    />
  );
}
