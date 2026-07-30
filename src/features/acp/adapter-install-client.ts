import { invoke } from "@tauri-apps/api/core";
import type { AdapterInstallPlan } from "@/generated/bindings/AdapterInstallPlan";
import type { AdapterInstallResult } from "@/generated/bindings/AdapterInstallResult";
import type { AgentKind } from "@/generated/bindings/AgentKind";

export function adapterInstallPlan(agent: AgentKind): Promise<AdapterInstallPlan> {
  return invoke("adapter_install_plan", { agent });
}

export function installAdapter(agent: AgentKind): Promise<AdapterInstallResult> {
  return invoke("install_adapter", { agent });
}
