import { memo, useMemo } from "react";
import { FileText, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Message } from "@/types/chat";
import type { AgentEvent } from "@/lib/ai/types";

type Part = NonNullable<Message["runtimeParts"]>[number];
type Permission = AgentEvent & { requestId: string };
type ToolPart = Part & {
  toolCallId: string;
  toolName?: string;
  state: string;
  input?: unknown;
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

export const AgentParts = memo(function AgentParts({
  parts,
}: {
  parts?: Message["runtimeParts"];
}) {
  const { permissions, tools } = useMemo(() => {
    const permissionMap = new Map<string, Permission>();
    const tools: ToolPart[] = [];
    for (const part of parts ?? []) {
      if (part.type === "data-agent") {
        const event = part.data as Permission;
        if (event.kind === "permission" && event.requestId) {
          permissionMap.set(event.approvalId, event as Permission);
        }
      } else if (toolName(part)) {
        tools.push(part as ToolPart);
      }
    }
    return {
      permissions: [...permissionMap.values()].filter((event) => event.status === "pending"),
      tools,
    };
  }, [parts]);
  if (!permissions.length && !tools.length) return null;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {tools.map((tool) => {
        const name = toolName(tool) ?? "Tool activity";
        return (
          <Card key={tool.toolCallId} className="shadow-none">
            <CardHeader className="py-3">
              <div className="flex items-start gap-3">
                {name.includes("exec") || name.includes("bash")
                  ? <Terminal className="mt-0.5 size-4" />
                  : <FileText className="mt-0.5 size-4" />}
                <div className="min-w-0 flex-1">
                  <CardTitle className="truncate text-sm">{name}</CardTitle>
                  {summarize(tool.input) ? (
                    <CardDescription className="truncate">{summarize(tool.input)}</CardDescription>
                  ) : null}
                </div>
                <Badge variant="secondary">{tool.state}</Badge>
              </div>
            </CardHeader>
          </Card>
        );
      })}
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
