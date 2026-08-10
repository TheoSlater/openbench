import { describe, expect, it, vi } from "vitest";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import { createRuntimeCatalogStore } from "@/features/runtime/catalog-store";
import { runtimeOptionsFromCatalog } from "@/features/runtime/runtime-options";

const connection: ConnectionSummary = {
  connection: {
    id: "openai",
    account_id: "account",
    provider: "openai",
    display_name: "OpenAI",
    enabled: true,
    base_url: null,
    secret_ref: null,
    extra_headers: null,
    position: 0,
  },
  health: { status: "ready", detail: null, last_validated_at: null },
  available_model_count: 1,
  enabled_model_count: 1,
};

const model = (id: string): ConnectionModel => ({
  connection_id: "openai",
  remote_id: id,
  display_name: id,
  capabilities: null,
  enabled: true,
  aliases: [],
  metadata: null,
  discovery_source: "remote",
  last_seen_at: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    listConnections: vi.fn().mockResolvedValue([connection]),
    listModels: vi.fn().mockResolvedValue([model("cached")]),
    refreshModels: vi.fn().mockResolvedValue([model("fresh")]),
    removeConnection: vi.fn().mockResolvedValue(undefined),
    listRecents: vi.fn().mockResolvedValue([]),
    agentStatus: vi.fn().mockResolvedValue({
      installed: true,
      authenticated: true,
      executable: "agent",
    }),
    agentModels: vi.fn().mockResolvedValue({ models: [{ id: "codex-model" }] }),
    now: vi.fn(() => 1),
    ...overrides,
  };
}

describe("runtime catalog", () => {
  it("hydrates cached models once and revalidates without blocking", async () => {
    const remote = deferred<ConnectionModel[]>();
    const mock = deps({ refreshModels: vi.fn(() => remote.promise) });
    const store = createRuntimeCatalogStore(mock);

    await Promise.all([
      store.getState().actions.start("account"),
      store.getState().actions.start("account"),
    ]);

    expect(mock.listConnections).toHaveBeenCalledTimes(1);
    expect(mock.listModels).toHaveBeenCalledTimes(1);
    expect(mock.refreshModels).toHaveBeenCalledTimes(1);
    expect(store.getState().modelsByConnection.openai).toEqual([model("cached")]);

    remote.resolve([model("fresh")]);
    await vi.waitFor(() => {
      expect(store.getState().modelsByConnection.openai).toEqual([model("fresh")]);
    });

    await store.getState().actions.refresh();
    expect(mock.refreshModels).toHaveBeenCalledTimes(2);
  });

  it("publishes ready agents independently and never probes Claude models", async () => {
    const claude = deferred<{ installed: boolean; authenticated: boolean }>();
    const mock = deps({
      listConnections: vi.fn().mockResolvedValue([]),
      agentStatus: vi.fn((kind: string) => kind === "codex"
        ? Promise.resolve({ installed: true, authenticated: true })
        : claude.promise),
    });
    const store = createRuntimeCatalogStore(mock);
    const starting = store.getState().actions.start("account");

    await vi.waitFor(() => {
      expect(store.getState().agents.codex.statusState).toBe("ready");
      expect(store.getState().agents["claude-code"].statusState).toBe("loading");
    });
    expect(runtimeOptionsFromCatalog(
      store.getState().connections,
      store.getState().modelsByConnection,
      store.getState().agents,
    )).toContainEqual(expect.objectContaining({ id: "agent:codex", agentKind: "codex" }));

    claude.resolve({ installed: true, authenticated: true });
    await starting;
    expect(mock.agentModels).toHaveBeenCalledTimes(1);
    expect(mock.agentModels).toHaveBeenCalledWith("codex");
    expect(store.getState().agents["claude-code"].models).toEqual([]);
  });

  it("keeps last-known models when background refresh fails", async () => {
    const mock = deps({ refreshModels: vi.fn().mockRejectedValue(new Error("offline")) });
    const store = createRuntimeCatalogStore(mock);

    await store.getState().actions.start("account");
    await vi.waitFor(() => expect(store.getState().connectionErrors.openai).toContain("offline"));

    expect(store.getState().modelsByConnection.openai).toEqual([model("cached")]);
    expect(store.getState().status).toBe("ready");
  });
});
