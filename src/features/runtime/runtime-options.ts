import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import type { AgentKind } from "@/generated/bindings/AgentKind";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import type { AgentCliStatus, AgentModelEntry } from "@/features/coding-agents/client";

export type RuntimeGroup =
  | "Coding agents"
  | "Recent models"
  | "Cloud models"
  | "Local models";

export type RuntimeOption = {
  id: string;
  family: "coding-agent" | "chat-model";
  agentKind?: AgentKind;
  group: Exclude<RuntimeGroup, "Recent models">;
  title: string;
  connection: string;
  available: boolean;
  runtime: RuntimeRef | null;
  /** Selected agent model id; absent lets the agent pick its default. */
  modelId?: string;
  status?: "ready" | "checking";
};

const GROUP_ORDER: RuntimeGroup[] = [
  "Recent models",
  "Coding agents",
  "Cloud models",
  "Local models",
];

export function runtimeRefId(runtime: RuntimeRef): string {
  if (runtime.kind === "chat-model") {
    return `model:${runtime.connection_id}:${runtime.model_id}`;
  }
  if (runtime.kind === "coding-agent") {
    return runtime.model_id
      ? `agent:${runtime.agent_kind}:${runtime.model_id}`
      : `agent:${runtime.agent_kind}`;
  }
  return `unresolved:${runtime.reason}`;
}

type AgentRuntimeSource = {
  kind: AgentKind;
  status: AgentCliStatus | null;
  statusState: "idle" | "loading" | "ready" | "error";
  models: AgentModelEntry[];
};

function agentOptions(agent: AgentRuntimeSource): RuntimeOption[] {
  const name = agentName(agent.kind);
  if (!agent.status && agent.statusState === "loading") {
    return [{
      id: `agent:${agent.kind}:checking`,
      family: "coding-agent",
      agentKind: agent.kind,
      group: "Coding agents",
      title: `Checking ${name}…`,
      connection: "Local CLI",
      available: false,
      runtime: null,
      status: "checking",
    }];
  }
  if (!agent.status?.installed || !agent.status.authenticated) return [];
  return [{
    id: `agent:${agent.kind}`,
    family: "coding-agent",
    agentKind: agent.kind,
    group: "Coding agents",
    title: name,
    connection: "CLI default",
    available: true,
    runtime: null,
    status: "ready",
  }, ...agent.models.filter(({ id }) => id).map((model) => ({
    id: `agent:${agent.kind}:${model.id}`,
    family: "coding-agent" as const,
    agentKind: agent.kind,
    group: "Coding agents" as const,
    title: model.name ?? model.id,
    connection: name,
    available: true,
    runtime: null,
    modelId: model.id,
    status: "ready" as const,
  }))];
}

export function runtimeOptionsFromCatalog(
  connections: ConnectionSummary[],
  modelsByConnection: Record<string, ConnectionModel[]>,
  agents: Record<AgentKind, AgentRuntimeSource>,
): RuntimeOption[] {
  const connectionOptions = connections.flatMap((summary) => {
    if (!summary.connection.enabled || summary.health.status === "failed") return [];
    return (modelsByConnection[summary.connection.id] ?? [])
      .filter((model) => model.enabled)
      .map((model) => ({
        id: `model:${summary.connection.id}:${model.remote_id}`,
        family: "chat-model" as const,
        group: ["ollama", "lmstudio"].includes(summary.connection.provider)
          ? "Local models" as const
          : "Cloud models" as const,
        title: model.display_name || model.remote_id,
        connection: summary.connection.display_name,
        available: true,
        runtime: {
          kind: "chat-model" as const,
          connection_id: summary.connection.id,
          model_id: model.remote_id,
        },
        status: "ready" as const,
      }));
  });
  return [...Object.values(agents).flatMap(agentOptions), ...connectionOptions];
}

export function runtimeIsAvailable(
  runtime: RuntimeRef | null,
  connections: ConnectionSummary[],
  modelsByConnection: Record<string, ConnectionModel[]>,
  agents: Record<AgentKind, AgentRuntimeSource>,
): boolean {
  if (!runtime || runtime.kind === "unresolved") return false;
  if (runtime.kind === "coding-agent") {
    const status = agents[runtime.agent_kind].status;
    return Boolean(status?.installed && status.authenticated);
  }
  const connection = connections.find(({ connection }) => connection.id === runtime.connection_id);
  return Boolean(
    connection?.connection.enabled
      && connection.health.status !== "failed"
      && modelsByConnection[runtime.connection_id]?.some(
        (model) => model.enabled && model.remote_id === runtime.model_id,
      ),
  );
}

export function filterRuntimeOptions(
  options: RuntimeOption[],
  query: string,
): RuntimeOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return options;
  return options.filter((option) =>
    `${option.title} ${option.connection}`.toLocaleLowerCase().includes(needle)
  );
}

export function groupRuntimeOptions(
  options: RuntimeOption[],
  recentIds: ReadonlySet<string>,
): Array<[RuntimeGroup, RuntimeOption[]]> {
  const groups = new Map<RuntimeGroup, RuntimeOption[]>();
  for (const option of options) {
    const group = recentIds.has(option.id) ? "Recent models" : option.group;
    const current = groups.get(group) ?? [];
    current.push(option);
    groups.set(group, current);
  }
  return GROUP_ORDER.flatMap((group) => {
    const items = groups.get(group);
    return items?.length ? [[group, items] as [RuntimeGroup, RuntimeOption[]]] : [];
  });
}

export function moveRuntimeHighlight(
  current: number,
  offset: number,
  count: number,
): number {
  return count ? (current + offset + count) % count : 0;
}

/** Display name for a coding agent, e.g. "Codex" or "Claude Code". */
export function agentName(kind: AgentKind): string {
  return kind === "codex" ? "Codex" : "Claude Code";
}

/** Display name for a runtime, for the header and toasts. */
export function runtimeLabel(runtime: RuntimeRef | null): string {
  if (!runtime) return "";
  if (runtime.kind === "chat-model") return runtime.model_id;
  if (runtime.kind === "coding-agent") {
    const name = agentName(runtime.agent_kind);
    return runtime.model_id ? `${name} · ${runtime.model_id}` : name;
  }
  return "";
}
