import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useAuthStore } from "@/store/authStore";
import { getSessionToken } from "@/lib/utils/utils";

export type ProviderType =
  | "OllamaLocal"
  | "OpenAICompatible"
  | "AnthropicNative"
  | "GeminiNative";
export type ProviderStatus = "Online" | "Offline" | "Reconnecting" | "Unavailable";

export interface ProviderConfig {
  id: number;
  account_id?: string;
  provider_type: ProviderType;
  enabled: boolean;
  ollama_host?: string;
  ollama_api_key?: string;
  ollama_api_base_url?: string;
  api_key?: string;
  api_base_url?: string;
  priority: number;
  preset?: string;
  headers?: string;
  model_suggestions?: string;
}

export function getCurrentProviderAccountId(): string {
  const auth = useAuthStore.getState();
  return auth.user?.id || auth.guestId || "";
}

export interface ProviderStatusResponse {
  provider_type: ProviderType;
  status: ProviderStatus;
  config: ProviderConfig;
}

interface AddProviderRequest {
  provider_type: ProviderType;
  enabled: boolean;
  ollama_host?: string;
  api_key?: string;
  api_base_url?: string;
  preset?: string;
  headers?: string;
  model_suggestions?: string;
}

interface ProviderStore {
  providers: ProviderStatusResponse[];
  loading: boolean;
  error: string | null;
  
  actions: {
    refresh: () => Promise<void>;
    setProviders: (providers: ProviderStatusResponse[]) => void;
    updateProviderConfig: (config: {
      id: number;
      provider_type: ProviderType;
      enabled?: boolean;
      ollama_host?: string;
      ollama_api_key?: string;
      ollama_api_base_url?: string;
      api_key?: string;
      api_base_url?: string;
      preset?: string;
      headers?: string;
      model_suggestions?: string;
    }) => Promise<void>;
    addProvider: (config: AddProviderRequest) => Promise<void>;
    deleteProvider: (id: number) => Promise<void>;
  };
}

export const useProviderStore = create<ProviderStore>((set) => ({
  providers: [],
  loading: false,
  error: null,

  actions: {
    refresh: async () => {
      set({ loading: true });
      try {
        const providers = await invoke<ProviderStatusResponse[]>("get_providers", {
          accountId: getCurrentProviderAccountId(),
          token: getSessionToken(),
        });
        set({ providers, loading: false, error: null });
      } catch (err) {
        set({ error: err as string, loading: false });
      }
    },
    setProviders: (providers) => set((state) => {
      if (!state.loading && JSON.stringify(state.providers) === JSON.stringify(providers)) {
        return state;
      }
      return { providers, loading: false, error: null };
    }),
    updateProviderConfig: async (config: {
      id: number;
      provider_type: ProviderType;
      enabled?: boolean;
      ollama_host?: string;
      ollama_api_key?: string;
      ollama_api_base_url?: string;
      api_key?: string;
      api_base_url?: string;
      preset?: string;
      headers?: string;
      model_suggestions?: string;
    }) => {
      const accountId = getCurrentProviderAccountId();
      const token = getSessionToken();
      const current = (await invoke<ProviderStatusResponse[]>("get_providers", {
        accountId,
        token,
      })).find((p) => p.config.id === config.id);
      if (!current) throw new Error("Provider not found");
      await invoke("update_provider_config", {
        request: { ...current.config, ...config },
        accountId,
        token,
      });
      set({ loading: true });
      const providers = await invoke<ProviderStatusResponse[]>("get_providers", {
        accountId,
        token,
      });
      set({ providers, loading: false, error: null });
    },
    addProvider: async (config: AddProviderRequest) => {
      const accountId = getCurrentProviderAccountId();
      const token = getSessionToken();
      await invoke("add_provider", { request: config, accountId, token });
      set({ loading: true });
      const providers = await invoke<ProviderStatusResponse[]>("get_providers", {
        accountId,
        token,
      });
      set({ providers, loading: false, error: null });
    },
    deleteProvider: async (id: number) => {
      const accountId = getCurrentProviderAccountId();
      const token = getSessionToken();
      await invoke("delete_provider", { id, accountId, token });
      set({ loading: true });
      const providers = await invoke<ProviderStatusResponse[]>("get_providers", {
        accountId,
        token,
      });
      set({ providers, loading: false, error: null });
    },
  }
}));
