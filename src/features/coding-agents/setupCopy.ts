/**
 * The one shared table coding-agent status wording comes from.
 *
 * Codex and Claude Code render the exact same state through the exact same
 * strings.
 */
export type AgentConfig = {
  /** Discriminates which setup client/verify call a card uses. */
  kind: "codex" | "claude-code";
  displayName: string;
  installDocsUrl: string;
};

export const CODEX_AGENT: AgentConfig = {
  kind: "codex",
  displayName: "Codex",
  installDocsUrl: "https://github.com/agentclientprotocol/codex-acp#installation",
};

export const CLAUDE_AGENT: AgentConfig = {
  kind: "claude-code",
  displayName: "Claude Code",
  installDocsUrl: "https://github.com/agentclientprotocol/claude-agent-acp",
};

export const CARD_STATUS = {
  detecting: "Checking…",
  ready: "READY",
  setUp: "Set up",
  signIn: "Sign in",
  retry: "Retry",
} as const;
