import { create } from "zustand";
import type { AgentKind } from "@/generated/bindings/AgentKind";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import {
  agentModels,
  agentStatus,
  type AgentCliStatus,
  type AgentModelEntry,
} from "@/features/coding-agents/client";
import { connectionsClient } from "@/features/connections/client";
import { runtimeRefId } from "./runtime-options";

export const AGENT_KINDS: AgentKind[] = ["codex", "claude-code"];
const FOCUS_REFRESH_MS = 30_000;

export type CatalogStatus = "idle" | "loading" | "ready" | "error";

export type AgentCatalogEntry = {
  kind: AgentKind;
  status: AgentCliStatus | null;
  statusState: CatalogStatus;
  models: AgentModelEntry[];
  modelsState: CatalogStatus;
  error: string | null;
};

type CatalogDeps = {
  listConnections: typeof connectionsClient.list;
  listModels: typeof connectionsClient.models;
  refreshModels: typeof connectionsClient.refreshModels;
  removeConnection: typeof connectionsClient.remove;
  listRecents: typeof connectionsClient.recents;
  agentStatus: typeof agentStatus;
  agentModels: typeof agentModels;
  now: () => number;
};

export type RuntimeCatalogState = {
  accountId: string | null;
  connections: ConnectionSummary[];
  modelsByConnection: Record<string, ConnectionModel[]>;
  refreshingConnectionIds: Set<string>;
  connectionErrors: Record<string, string | null>;
  agents: Record<AgentKind, AgentCatalogEntry>;
  recentRuntimeIds: Set<string>;
  status: CatalogStatus;
  error: string | null;
  lastCheckedAt: number | null;
  actions: {
    start: (accountId: string) => Promise<void>;
    refresh: () => Promise<void>;
    refreshConnection: (connectionId: string) => Promise<void>;
    refreshAgent: (kind: AgentKind) => Promise<void>;
    removeConnection: (connectionId: string) => Promise<void>;
    stop: () => void;
  };
};

const initialAgent = (kind: AgentKind): AgentCatalogEntry => ({
  kind,
  status: null,
  statusState: "idle",
  models: [],
  modelsState: "idle",
  error: null,
});

const initialAgents = (): RuntimeCatalogState["agents"] => ({
  codex: initialAgent("codex"),
  "claude-code": initialAgent("claude-code"),
});

const defaultDeps: CatalogDeps = {
  listConnections: connectionsClient.list,
  listModels: connectionsClient.models,
  refreshModels: connectionsClient.refreshModels,
  removeConnection: connectionsClient.remove,
  listRecents: connectionsClient.recents,
  agentStatus,
  agentModels,
  now: Date.now,
};

export function createRuntimeCatalogStore(deps: CatalogDeps = defaultDeps) {
  let startPromise: Promise<void> | null = null;
  let refreshPromise: Promise<void> | null = null;
  let detachFocus: (() => void) | null = null;
  const agentPromises = new Map<AgentKind, Promise<void>>();
  const agentModelPromises = new Map<AgentKind, Promise<void>>();
  const connectionPromises = new Map<string, Promise<void>>();

  return create<RuntimeCatalogState>((set, get) => {
    const updateAgent = (kind: AgentKind, update: Partial<AgentCatalogEntry>) => {
      set((state) => ({
        agents: {
          ...state.agents,
          [kind]: { ...state.agents[kind], ...update },
        },
      }));
    };

    const loadAgentModels = (kind: AgentKind, accountId: string) => {
      if (kind === "claude-code") {
        updateAgent(kind, { models: [], modelsState: "ready" });
        return Promise.resolve();
      }
      const pending = agentModelPromises.get(kind);
      if (pending) return pending;
      const promise = (async () => {
        updateAgent(kind, { modelsState: "loading" });
        try {
          const result = await deps.agentModels(kind);
          if (get().accountId !== accountId) return;
          updateAgent(kind, { models: result.models, modelsState: "ready", error: null });
        } catch (error) {
          if (get().accountId !== accountId) return;
          updateAgent(kind, { modelsState: "error", error: String(error) });
        }
      })();
      agentModelPromises.set(kind, promise);
      void promise.finally(() => {
        if (agentModelPromises.get(kind) === promise) agentModelPromises.delete(kind);
      });
      return promise;
    };

    const refreshAgent = (kind: AgentKind) => {
      const pending = agentPromises.get(kind);
      if (pending) return pending;
      const accountId = get().accountId;
      if (!accountId) return Promise.resolve();
      const promise = (async () => {
        const existing = get().agents[kind];
        updateAgent(kind, {
          statusState: existing.status ? "ready" : "loading",
          error: null,
        });
        try {
          const status = await deps.agentStatus(kind);
          if (get().accountId !== accountId) return;
          updateAgent(kind, { status, statusState: "ready", error: null });
          if (status.installed && status.authenticated) {
            void loadAgentModels(kind, accountId);
          } else {
            updateAgent(kind, { models: [], modelsState: "idle" });
          }
        } catch (error) {
          if (get().accountId !== accountId) return;
          updateAgent(kind, { statusState: "error", error: String(error) });
        }
      })();
      agentPromises.set(kind, promise);
      void promise.finally(() => {
        if (agentPromises.get(kind) === promise) agentPromises.delete(kind);
      });
      return promise;
    };

    const loadCachedModels = async (connectionId: string, accountId: string) => {
      try {
        const models = await deps.listModels(connectionId);
        if (get().accountId !== accountId) return;
        set((state) => ({
          modelsByConnection: { ...state.modelsByConnection, [connectionId]: models },
          connectionErrors: { ...state.connectionErrors, [connectionId]: null },
        }));
      } catch (error) {
        if (get().accountId !== accountId) return;
        set((state) => ({
          connectionErrors: { ...state.connectionErrors, [connectionId]: String(error) },
        }));
      }
    };

    const refreshConnection = (connectionId: string) => {
      const pending = connectionPromises.get(connectionId);
      if (pending) return pending;
      const accountId = get().accountId;
      if (!accountId) return Promise.resolve();
      const promise = (async () => {
        set((state) => ({
          refreshingConnectionIds: new Set(state.refreshingConnectionIds).add(connectionId),
          connectionErrors: { ...state.connectionErrors, [connectionId]: null },
        }));
        try {
          const models = await deps.refreshModels(connectionId);
          if (get().accountId !== accountId) return;
          set((state) => ({
            modelsByConnection: { ...state.modelsByConnection, [connectionId]: models },
          }));
        } catch (error) {
          if (get().accountId !== accountId) return;
          set((state) => ({
            connectionErrors: { ...state.connectionErrors, [connectionId]: String(error) },
          }));
        } finally {
          if (get().accountId === accountId) {
            set((state) => {
              const refreshingConnectionIds = new Set(state.refreshingConnectionIds);
              refreshingConnectionIds.delete(connectionId);
              return { refreshingConnectionIds };
            });
          }
        }
      })();
      connectionPromises.set(connectionId, promise);
      void promise.finally(() => {
        if (connectionPromises.get(connectionId) === promise) connectionPromises.delete(connectionId);
      });
      return promise;
    };

    const loadConnections = async (accountId: string) => {
      const connections = await deps.listConnections(accountId);
      if (get().accountId !== accountId) return;
      set({ connections });
      await Promise.allSettled(
        connections.map(({ connection }) => loadCachedModels(connection.id, accountId)),
      );
    };

    const loadRecents = async (accountId: string) => {
      try {
        const recents = await deps.listRecents(accountId);
        if (get().accountId !== accountId) return;
        set({ recentRuntimeIds: new Set(recents.map(runtimeRefId)) });
      } catch {
        if (get().accountId === accountId) set({ recentRuntimeIds: new Set() });
      }
    };

    const revalidateConnections = async (accountId: string) => {
      const connections = get().connections.filter(({ connection, health }) =>
        connection.enabled && health.status !== "failed"
      );
      await Promise.allSettled(
        connections.map(({ connection }) => refreshConnection(connection.id)),
      );
      if (get().accountId !== accountId) return;
      try {
        set({ connections: await deps.listConnections(accountId) });
      } catch {
        // Per-source errors already preserve the last known catalog.
      }
    };

    const refresh = () => {
      if (refreshPromise) return refreshPromise;
      const accountId = get().accountId;
      if (!accountId) return Promise.resolve();
      const promise = (async () => {
        const priorIds = new Set(get().connections.map(({ connection }) => connection.id));
        const results = await Promise.allSettled([
          deps.listConnections(accountId),
          loadRecents(accountId),
          ...AGENT_KINDS.map(refreshAgent),
        ]);
        if (get().accountId !== accountId) return;
        const connectionResult = results[0];
        if (connectionResult.status === "fulfilled") {
          const connections = connectionResult.value as ConnectionSummary[];
          set({ connections, error: null, status: "ready" });
          await Promise.allSettled(
            connections
              .filter(({ connection }) => !priorIds.has(connection.id))
              .map(({ connection }) => loadCachedModels(connection.id, accountId)),
          );
          await Promise.allSettled(
            connections
              .filter(({ connection, health }) => connection.enabled && health.status !== "failed")
              .map(({ connection }) => refreshConnection(connection.id)),
          );
        } else {
          set({ error: String(connectionResult.reason), status: get().connections.length ? "ready" : "error" });
        }
        if (get().accountId === accountId) set({ lastCheckedAt: deps.now() });
      })();
      refreshPromise = promise;
      void promise.finally(() => {
        if (refreshPromise === promise) refreshPromise = null;
      });
      return promise;
    };

    const start = (accountId: string) => {
      if (!accountId) return Promise.resolve();
      if (get().accountId === accountId && get().status === "ready") return Promise.resolve();
      if (get().accountId === accountId && startPromise) return startPromise;
      if (get().accountId !== accountId) {
        startPromise = null;
        refreshPromise = null;
        agentPromises.clear();
        agentModelPromises.clear();
        connectionPromises.clear();
        set({
          accountId,
          connections: [],
          modelsByConnection: {},
          refreshingConnectionIds: new Set(),
          connectionErrors: {},
          agents: initialAgents(),
          recentRuntimeIds: new Set(),
          status: "loading",
          error: null,
          lastCheckedAt: null,
        });
      } else {
        set({ status: "loading", error: null });
      }
      if (!detachFocus && typeof window !== "undefined") {
        const onFocus = () => {
          const state = get();
          if (state.accountId && deps.now() - (state.lastCheckedAt ?? 0) >= FOCUS_REFRESH_MS) {
            void state.actions.refresh();
          }
        };
        window.addEventListener("focus", onFocus);
        detachFocus = () => window.removeEventListener("focus", onFocus);
      }
      const promise = (async () => {
        const results = await Promise.allSettled([
          loadConnections(accountId),
          loadRecents(accountId),
          ...AGENT_KINDS.map(refreshAgent),
        ]);
        if (get().accountId !== accountId) return;
        const connectionResult = results[0];
        set({
          status: connectionResult.status === "fulfilled" ? "ready" : "error",
          error: connectionResult.status === "rejected" ? String(connectionResult.reason) : null,
          lastCheckedAt: deps.now(),
        });
        if (connectionResult.status === "fulfilled") void revalidateConnections(accountId);
      })();
      startPromise = promise;
      void promise.finally(() => {
        if (startPromise === promise) startPromise = null;
      });
      return promise;
    };

    return {
      accountId: null,
      connections: [],
      modelsByConnection: {},
      refreshingConnectionIds: new Set(),
      connectionErrors: {},
      agents: initialAgents(),
      recentRuntimeIds: new Set(),
      status: "idle",
      error: null,
      lastCheckedAt: null,
      actions: {
        start,
        refresh,
        refreshConnection,
        refreshAgent,
        removeConnection: async (connectionId) => {
          await deps.removeConnection(connectionId);
          set((state) => {
            const modelsByConnection = { ...state.modelsByConnection };
            const connectionErrors = { ...state.connectionErrors };
            delete modelsByConnection[connectionId];
            delete connectionErrors[connectionId];
            return {
              connections: state.connections.filter(({ connection }) => connection.id !== connectionId),
              modelsByConnection,
              connectionErrors,
            };
          });
        },
        stop: () => {
          detachFocus?.();
          detachFocus = null;
        },
      },
    };
  });
}

export const useRuntimeCatalogStore = createRuntimeCatalogStore();
