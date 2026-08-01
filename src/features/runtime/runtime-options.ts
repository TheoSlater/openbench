import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";

export type RuntimeGroup =
  | "Coding agents"
  | "Recent models"
  | "Cloud models"
  | "Local models";

export type RuntimeOption = {
  id: string;
  family: "coding-agent" | "chat-model";
  group: Exclude<RuntimeGroup, "Recent models">;
  title: string;
  connection: string;
  available: boolean;
  runtime: RuntimeRef | null;
};

const GROUP_ORDER: RuntimeGroup[] = [
  "Coding agents",
  "Recent models",
  "Cloud models",
  "Local models",
];

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
    const group =
      option.family === "chat-model" && recentIds.has(option.id)
        ? "Recent models"
        : option.group;
    const current = groups.get(group) ?? [];
    current.push(option);
    groups.set(group, current);
  }
  return GROUP_ORDER.flatMap((group) => {
    const items = groups.get(group);
    return items?.length ? [[group, items] as [RuntimeGroup, RuntimeOption[]]] : [];
  });
}

/** "External" means a cloud connection, as opposed to a local one (Ollama, LM Studio). */
export function isExternalOption(option: RuntimeOption): boolean {
  return option.family === "chat-model" && option.group !== "Local models";
}

/** "Local" means Ollama/LM Studio — coding agents are neither local nor external. */
export function isLocalOption(option: RuntimeOption): boolean {
  return option.family === "chat-model" && option.group === "Local models";
}

export function moveRuntimeHighlight(
  current: number,
  offset: number,
  count: number,
): number {
  return count ? (current + offset + count) % count : 0;
}

/** Display name for a runtime, for the header and toasts. */
export function runtimeLabel(runtime: RuntimeRef | null): string {
  if (!runtime) return "";
  if (runtime.kind === "chat-model") return runtime.model_id;
  if (runtime.kind === "coding-agent") {
    return runtime.agent_kind === "codex" ? "Codex" : "Claude Code";
  }
  return "";
}
