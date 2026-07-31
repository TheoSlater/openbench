import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";

// The pre-rework default lived in this bare localStorage key, written by
// modelStore. Checkpoint 7 flipped the chat path to read the migrated
// RuntimeRef instead, so nothing reads this key anymore once it resolves.
export const LEGACY_DEFAULT_MODEL_KEY = "default_model";
export const DEFAULT_RUNTIME_KEY = "polyui:default-runtime";
const MIGRATED_FLAG_KEY = "polyui:default-runtime-migrated";

export type ResolveLegacyDefault = (stored: string) => Promise<RuntimeRef | null>;

/**
 * Resolve the legacy `default_model` string against the migrated schema, once.
 *
 * The old frontend parser rejected `AnthropicNative` and `GeminiNative`
 * outright, so a default saved for either never applied and was silently
 * retried on every launch. Rust does the resolution now because only it can see
 * the connections table.
 *
 * Returns the runtime reference it stored, or null when there was nothing to
 * migrate or the stored value no longer resolves. An unresolvable value marks
 * itself migrated so it is not retried forever — the specific bug this
 * replaces.
 */
export async function migrateLegacyDefaultModel(
  resolve: ResolveLegacyDefault,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): Promise<RuntimeRef | null> {
  const stored = storage.getItem(LEGACY_DEFAULT_MODEL_KEY)?.trim();
  if (!stored) return null;

  let resolved: RuntimeRef | null = null;
  try {
    resolved = await resolve(stored);
  } catch (error) {
    // A failed lookup is not a failed migration — leave the flag unset so the
    // next launch retries rather than losing the user's default.
    console.warn("[runtime] could not resolve the legacy default model", error);
    return null;
  }

  if (resolved) {
    storage.setItem(DEFAULT_RUNTIME_KEY, JSON.stringify(resolved));
  }
  storage.removeItem(LEGACY_DEFAULT_MODEL_KEY);
  storage.removeItem(MIGRATED_FLAG_KEY);
  return resolved;
}

/** The migrated default, if one was resolved. */
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

/** Whether the given runtime is the stored default. */
export function isDefaultRuntime(
  runtime: RuntimeRef,
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  const current = readDefaultRuntime(storage);
  if (!current) return false;
  switch (runtime.kind) {
    case "chat-model":
      return (
        current.kind === "chat-model" &&
        current.connection_id === runtime.connection_id &&
        current.model_id === runtime.model_id
      );
    case "coding-agent":
      return (
        current.kind === "coding-agent" &&
        current.installation_id === runtime.installation_id &&
        current.workspace_id === runtime.workspace_id
      );
    default:
      return current.kind === "unresolved" && current.reason === runtime.reason;
  }
}
