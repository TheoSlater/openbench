import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";

export const DEFAULT_RUNTIME_KEY = "polyui:default-runtime";

export function readDefaultRuntime(
  storage: Pick<Storage, "getItem"> = localStorage,
): RuntimeRef | null {
  const raw = storage.getItem(DEFAULT_RUNTIME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RuntimeRef;
  } catch {
    return null;
  }
}

export function writeDefaultRuntime(
  runtime: RuntimeRef,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(DEFAULT_RUNTIME_KEY, JSON.stringify(runtime));
}

export function isDefaultRuntime(
  runtime: RuntimeRef,
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  const current = readDefaultRuntime(storage);
  if (!current) return false;
  switch (runtime.kind) {
    case "chat-model":
      return current.kind === "chat-model"
        && current.connection_id === runtime.connection_id
        && current.model_id === runtime.model_id;
    case "coding-agent":
      return current.kind === "coding-agent"
        && current.installation_id === runtime.installation_id
        && current.workspace_id === runtime.workspace_id;
    default:
      return current.kind === "unresolved" && current.reason === runtime.reason;
  }
}
