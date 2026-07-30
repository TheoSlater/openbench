import { create } from "zustand";
import type { ConnectionModel } from "@/generated/bindings/ConnectionModel";
import type { ConnectionSummary } from "@/generated/bindings/ConnectionSummary";
import { connectionsClient } from "./client";

type ConnectionsState = {
  summaries: ConnectionSummary[];
  models: Record<string, ConnectionModel[]>;
  loading: boolean;
  error: string | null;
  actions: {
    load: (accountId: string) => Promise<void>;
    loadModels: (connectionId: string, refresh?: boolean) => Promise<void>;
    remove: (accountId: string, connectionId: string) => Promise<void>;
  };
};

export const useConnectionsStore = create<ConnectionsState>((set) => ({
  summaries: [],
  models: {},
  loading: false,
  error: null,
  actions: {
    load: async (accountId) => {
      set({ loading: true, error: null });
      try {
        set({ summaries: await connectionsClient.list(accountId), loading: false });
      } catch (error) {
        set({ loading: false, error: String(error) });
      }
    },
    loadModels: async (connectionId, refresh = false) => {
      const models = refresh
        ? await connectionsClient.refreshModels(connectionId)
        : await connectionsClient.models(connectionId);
      set((state) => ({ models: { ...state.models, [connectionId]: models } }));
    },
    remove: async (accountId, connectionId) => {
      await connectionsClient.remove(connectionId);
      set((state) => ({
        summaries: state.summaries.filter(
          (item) => item.connection.id !== connectionId,
        ),
      }));
      await useConnectionsStore.getState().actions.load(accountId);
    },
  },
}));
