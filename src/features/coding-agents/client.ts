import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig } from "./setupCopy";

export type AgentCliStatus = {
  installed: boolean;
  authenticated: boolean;
  executable?: string;
  version?: string;
};

export const agentStatus = (kind: AgentConfig["kind"]) =>
  invoke<AgentCliStatus>("agent_cli_status", { kind });
