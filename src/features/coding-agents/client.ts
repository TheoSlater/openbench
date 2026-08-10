import { invoke } from "@/lib/tauriBridge";
import type { AgentConfig } from "./setupCopy";

export type AgentCliStatus = {
  installed: boolean;
  authenticated: boolean;
  executable?: string;
  version?: string;
};

export type AgentModelEntry = {
  id: string;
  name?: string;
};

export type AgentModelsResult = {
  models: AgentModelEntry[];
  defaultId?: string;
};

export const agentStatus = (kind: AgentConfig["kind"]) =>
  invoke<AgentCliStatus>("agent_cli_status", { kind });

export const agentModels = (kind: AgentConfig["kind"]) =>
  invoke<AgentModelsResult>("ai_runtime_agent_models", {
    requestId: crypto.randomUUID(),
    kind,
  });
