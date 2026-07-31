import type { Connection } from "@/generated/bindings/Connection";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";

export function groupConnections(connections: ConnectionSummary[]) {
  return {
    cloud: connections.filter((item) =>
      ["openai", "anthropic", "gemini", "openrouter", "vercel-gateway"].includes(
        item.connection.provider,
      )
    ),
    local: connections.filter((item) =>
      ["ollama", "lmstudio"].includes(item.connection.provider)
    ),
    custom: connections.filter(
      (item) => item.connection.provider === "openai-compatible",
    ),
  };
}

export function safeEndpointSummary(connection: Connection): string {
  if (!connection.base_url) return "Default endpoint";
  try {
    return new URL(connection.base_url).host;
  } catch {
    return "Custom endpoint";
  }
}
