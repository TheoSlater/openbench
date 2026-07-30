import { AlertCircle, Bot, CheckCircle2, ChevronDown, Circle, FileText, ListTodo, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownProse } from "@/features/chat/components/Message/MarkdownProse";
import type { PermissionDecision } from "@/generated/bindings/PermissionDecision";
import { acpErrorMessage, needsReauthentication } from "@/lib/acp/errorMessage";
import type { AcpActivityState } from "./activity-reducer";

export function AcpActivity({
  state,
  onDecision,
  onReauthenticate,
}: {
  state: AcpActivityState;
  onDecision: (requestId: string, decision: PermissionDecision) => void;
  onReauthenticate: () => void;
}) {
  const tools = Object.values(state.tools);
  const hasActivity = Boolean(
    state.answer || state.thought || tools.length || state.plan.length ||
    state.permission || state.error || state.status === "running",
  );
  if (!hasActivity) return null;

  return (
    <div className="flex flex-col gap-3 py-4" aria-live="polite">
      {state.thought ? (
        <details open={state.thinking || undefined}>
          <summary className="flex w-full cursor-pointer list-none items-center gap-2 text-left text-xs text-muted-foreground">
            <Bot className="size-4" />
            {state.thinking ? "Thinking…" : "Reasoning"}
            <ChevronDown className="ml-auto size-4" />
          </summary>
          <div className="mt-2 border-l border-border pl-4 text-sm text-muted-foreground">
            {state.thought}
          </div>
        </details>
      ) : null}

      {state.plan.length ? (
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><ListTodo className="size-4" />Plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {state.plan.map((step, index) => (
              <div key={`${step.content}-${index}`} className="flex items-start gap-2 text-sm">
                {step.status === "completed" ? <CheckCircle2 className="mt-0.5 size-4 text-primary" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                <span>{step.content}</span>
                <Badge variant="secondary" className="ml-auto">{step.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {tools.length ? (
        <div className="flex flex-col gap-2">
          {tools.map((tool) => (
            <Card key={tool.tool_call_id} className="shadow-none">
              <CardHeader className="py-3">
                <div className="flex items-start gap-3">
                  {tool.kind === "execute" ? <Terminal className="mt-0.5 size-4" /> : <FileText className="mt-0.5 size-4" />}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-sm">{tool.title || tool.kind || "Tool activity"}</CardTitle>
                    {tool.locations.length ? (
                      <CardDescription className="truncate">{tool.locations.map((item) => item.path).join(", ")}</CardDescription>
                    ) : null}
                  </div>
                  {tool.status ? <Badge variant="secondary">{tool.status}</Badge> : null}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      {state.permission ? (
        <Card className="border-primary/30 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">Permission required</CardTitle>
            <CardDescription>{state.permission.action}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.permission.command ? (
              <code className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">{state.permission.command}</code>
            ) : null}
            {state.permission.affected_paths.length ? (
              <div className="text-xs text-muted-foreground">{state.permission.affected_paths.join(", ")}</div>
            ) : null}
            {state.permission.working_directory ? (
              <div className="text-xs text-muted-foreground">Working directory: {state.permission.working_directory}</div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {state.permission.choices.map((choice) => (
                <Button
                  key={choice.option_id}
                  variant={choice.kind.startsWith("reject") ? "outline" : "default"}
                  onClick={() => onDecision(state.permission!.request_id, {
                    outcome: "selected",
                    option_id: choice.option_id,
                  })}
                >
                  {choice.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Agent stopped</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{acpErrorMessage(state.error)}</span>
            {needsReauthentication(state.error) ? (
              <Button size="sm" variant="outline" onClick={onReauthenticate}>
                Sign in again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.lagged ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>Some activity could not be displayed</AlertTitle>
          <AlertDescription>{state.lagged} low-priority updates were dropped.</AlertDescription>
        </Alert>
      ) : null}

      {state.answer ? <MarkdownProse content={state.answer} streaming={state.status === "running"} /> : null}
      {state.status === "completed" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-4" />Completed
        </div>
      ) : null}
    </div>
  );
}
