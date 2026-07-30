import { describe, expect, it } from "vitest";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import { groupConnections, safeEndpointSummary } from "@/features/connections/presentation";

const summary = (provider: ConnectionSummary["connection"]["provider"]): ConnectionSummary => ({
  connection: {
    id: provider,
    account_id: "acct",
    provider,
    display_name: provider,
    enabled: true,
    base_url: null,
    secret_ref: null,
    extra_headers: null,
    position: 0,
  },
  health: { status: "never", detail: null, last_validated_at: null },
  available_model_count: 0,
  enabled_model_count: 0,
});

describe("connections presentation", () => {
  it("groups cloud, local, and custom connections", () => {
    const grouped = groupConnections([
      summary("openai"),
      summary("ollama"),
      summary("openai-compatible"),
    ]);
    expect(grouped.cloud).toHaveLength(1);
    expect(grouped.local).toHaveLength(1);
    expect(grouped.custom).toHaveLength(1);
  });

  it("shows host only and strips endpoint credentials/query", () => {
    const connection = summary("openai-compatible").connection;
    connection.base_url = "https://user:secret@example.test/v1?token=secret";
    expect(safeEndpointSummary(connection)).toBe("example.test");
  });
});
