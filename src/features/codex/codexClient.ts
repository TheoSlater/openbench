import { invoke } from "@tauri-apps/api/core";
import type { CodexDetection } from "@/generated/bindings/CodexDetection";
import type { CodexSettings } from "@/generated/bindings/CodexSettings";
import type { CodexSetupView } from "@/generated/bindings/CodexSetupView";

export const INSTALL_DOCS_URL = "https://github.com/agentclientprotocol/codex-acp#installation";

/**
 * Read the cached setup state. Never spawns a process, so this is safe to call
 * whenever the settings page renders.
 */
export function codexStatus(settings: CodexSettings): Promise<CodexSetupView> {
  return invoke<CodexSetupView>("codex_status", { settings });
}

export function codexRevalidate(): Promise<CodexSetupView> {
  return invoke<CodexSetupView>("codex_revalidate");
}

/** Re-scan the filesystem. Background refresh; still spawn-free. */
export function codexRefreshDetection(settings: CodexSettings): Promise<CodexDetection> {
  return invoke<CodexDetection>("codex_refresh_detection", { settings });
}

/**
 * Start the adapter and complete a real ACP handshake.
 *
 * Spawns a process, so it is only ever called from the setup sheet — never
 * from an effect that runs on render. `workspace` may be left empty: this is
 * a throwaway handshake, not a conversation, so it falls back to the user's
 * home directory rather than asking them to pick one.
 */
export function codexVerify(settings: CodexSettings, workspace = ""): Promise<CodexSetupView> {
  return invoke<CodexSetupView>("codex_verify", { settings, workspace });
}

export function codexAuthenticate(
  settings: CodexSettings,
  workspace = "",
): Promise<CodexSetupView> {
  return invoke<CodexSetupView>("codex_authenticate", { settings, workspace });
}

export function codexCancelAuthenticate(): Promise<void> {
  return invoke("codex_cancel_authenticate");
}
