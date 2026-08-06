import { memo, useEffect, useMemo, useState } from "react";
import { FileText, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ui/reasoning";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { Message } from "@/types/chat";
import type { AgentEvent } from "@/lib/ai/types";
import { respondToToolApproval } from "@/features/chat/runtime/ChatRuntime";

type Part = NonNullable<Message["runtimeParts"]>[number];
type Permission = Extract<AgentEvent, { kind: "permission" }> & { requestId: string };
type PlanEvent = Extract<AgentEvent, { kind: "plan" | "task" }>;
type ToolPart = Part & {
  toolCallId: string;
  toolName?: string;
  state: string;
  input?: unknown;
  approval?: { id: string; isAutomatic?: boolean };
};

const toolName = (part: Part) => part.type === "dynamic-tool"
  ? part.toolName
  : part.type.startsWith("tool-") ? part.type.slice(5) : undefined;

function summarize(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  return [value.command, value.path, value.file_path, value.cwd]
    .find((item): item is string => typeof item === "string");
}

const isTerminalTool = (name: string) =>
  /exec|bash|shell|command/.test(name.toLowerCase());

const isDoneState = (state: string) =>
  ["output-available", "output-error", "input-error", "output-denied"].includes(state);

const stateLabel = (state: string) => {
  if (state === "output-available") return "done";
  if (state === "output-error" || state === "input-error") return "error";
  if (state === "approval-requested") return "approval";
  if (state === "output-denied") return "denied";
  return "running";
};

export const AgentParts = memo(function AgentParts({
  parts,
  status,
  compact = false,
}: {
  parts?: Message["runtimeParts"];
  status?: string;
  compact?: boolean;
}) {
  const { permissions, plans, tools } = useMemo(() => {
    const permissionMap = new Map<string, Permission>();
    const planMap = new Map<string, PlanEvent>();
    const tools: ToolPart[] = [];
    for (const part of parts ?? []) {
      if (part.type === "data-agent") {
        const event = part.data as AgentEvent & { requestId?: string };
        if (event.kind === "permission" && event.requestId) {
          permissionMap.set(event.approvalId, event as Permission);
        } else if (event.kind === "plan" || event.kind === "task") {
          planMap.set(event.id, event as PlanEvent);
        }
      } else if (toolName(part)) {
        tools.push(part as ToolPart);
      }
    }
    return {
      permissions: [...permissionMap.values()].filter((event) => event.status === "pending"),
      plans: [...planMap.values()],
      tools,
    };
  }, [parts]);

  const running = tools.some((tool) => !isDoneState(tool.state));
  const [expanded, setExpanded] = useState(!running);

  useEffect(() => {
    if (running) {
      setExpanded(true);
    } else if (["complete", "aborted", "error"].includes(status ?? "")) {
      setExpanded(false);
    }
  }, [running, status]);

  if (!permissions.length && !plans.length && !tools.length) return null;

  return (
    <div className={`${compact ? "" : "mb-3"} flex flex-col gap-2`}>
      {tools.length > 0 && (
        <Reasoning
          open={expanded}
          onOpenChange={setExpanded}
          isStreaming={running}
          className={compact ? "" : "my-1"}
        >
          <ReasoningTrigger>
            {running ? (
              <TextShimmer duration={2} spread={15}>
                Using a tool…
              </TextShimmer>
            ) : tools.length === 1 ? (
              "Used a tool"
            ) : (
              "Used tools"
            )}
          </ReasoningTrigger>
          <ReasoningContent className="border-none pt-1 pl-0">
            <ul className="flex flex-col gap-1.5">
              {tools.map((tool) => {
                const name = toolName(tool) ?? "Tool activity";
                return (
                  <li key={tool.toolCallId} className="flex items-center gap-2">
                    {isTerminalTool(name)
                      ? <Terminal className="size-3.5 shrink-0" />
                      : <FileText className="size-3.5 shrink-0" />}
                    <span className="truncate font-medium text-foreground">{name}</span>
                    {summarize(tool.input) ? (
                      <span className="truncate text-muted-foreground">
                        {summarize(tool.input)}
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="ml-auto shrink-0">
                      {stateLabel(tool.state)}
                    </Badge>
                    {tool.state === "approval-requested" && tool.approval && !tool.approval.isAutomatic ? (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          onClick={() => respondToToolApproval(tool.approval!.id, true)}
                        >
                          Allow
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respondToToolApproval(tool.approval!.id, false)}
                        >
                          Deny
                        </Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </ReasoningContent>
        </Reasoning>
      )}
      {plans.map((plan) => (
        <Card key={plan.id} className="shadow-none">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">{plan.text}</CardTitle>
              <Badge variant="secondary">{plan.status}</Badge>
            </div>
          </CardHeader>
        </Card>
      ))}
      {permissions.map((permission) => (
        <Card key={permission.approvalId} className="border-primary/30 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Permission required</CardTitle>
            <CardDescription>{permission.action}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {permission.command ? (
              <code className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">
                {permission.command}
              </code>
            ) : null}
            {permission.paths?.length ? (
              <div className="text-xs text-muted-foreground">{permission.paths.join(", ")}</div>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={() => void invoke("ai_runtime_approval", {
                requestId: permission.requestId,
                approvalId: permission.approvalId,
                approved: true,
                reason: null,
              })}>Allow</Button>
              <Button variant="outline" onClick={() => void invoke("ai_runtime_approval", {
                requestId: permission.requestId,
                approvalId: permission.approvalId,
                approved: false,
                reason: "User denied permission.",
              })}>Deny</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
});

AgentParts.displayName = "AgentParts";
