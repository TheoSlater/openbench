import { invoke } from "@/lib/tauriBridge";
import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { getWebSearchProvider } from "./registry";
import type { WebSearchProviderId } from "./types";

export function useWebSearchConfig() {
  const webSearch = useSettingsStore((state) => state.general.webSearch);
  const provider = getWebSearchProvider(webSearch.provider);
  return { provider, webSearch };
}

export function useWebSearchCredential(provider: WebSearchProviderId) {
  const [configured, setConfigured] = useState(provider === "local");

  useEffect(() => {
    if (provider === "local") return setConfigured(true);
    let active = true;
    void invoke<boolean>("web_search_credential_status", { provider })
      .then((value) => { if (active) setConfigured(value); })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, [provider]);

  const save = useCallback(async (credential: string) => {
    const value = credential.trim();
    await invoke("set_web_search_credential", {
      provider,
      credential: value || null,
    });
    setConfigured(Boolean(value));
  }, [provider]);

  return { configured, save };
}
