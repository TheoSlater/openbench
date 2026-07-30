import { invoke } from "@tauri-apps/api/core";
import type { ClaudeDetection } from "@/generated/bindings/ClaudeDetection";
import type { ClaudeSettings } from "@/generated/bindings/ClaudeSettings";
import type { ClaudeSetupView } from "@/generated/bindings/ClaudeSetupView";

export const INSTALL_DOCS_URL = "https://github.com/agentclientprotocol/claude-agent-acp";

/**
 * Read the cached setup state. Never spawns a process, so this is safe to call
 * whenever the settings page renders.
 */
export function claudeStatus(settings: ClaudeSettings): Promise<ClaudeSetupView> {
  return invoke("claude_status", { settings });
}

export function claudeRevalidate(): Promise<ClaudeSetupView> {
  return invoke<ClaudeSetupView>("claude_revalidate");
}

/** Re-scan the filesystem. Background refresh; still spawn-free. */
export function claudeRefreshDetection(
  settings: ClaudeSettings,
): Promise<ClaudeDetection> {
  return invoke("claude_refresh_detection", { settings });
}

/**
 * Start the adapter and complete a real ACP handshake.
 *
 * Spawns a process, so it is only ever called from the setup sheet — never
 * from an effect that runs on render. `workspace` may be left empty: this is
 * a throwaway handshake, not a conversation, so it falls back to the user's
 * home directory rather than asking them to pick one.
 */
export function claudeVerify(
  settings: ClaudeSettings,
  workspace = "",
): Promise<ClaudeSetupView> {
  return invoke("claude_verify", { settings, workspace });
}

export function claudeAuthenticate(
  settings: ClaudeSettings,
  workspace = "",
): Promise<ClaudeSetupView> {
  return invoke("claude_authenticate", { settings, workspace });
}

export function claudeCancelAuthenticate(): Promise<void> {
  return invoke("claude_cancel_authenticate");
}
