import { ollamaClient } from "./client";
import type { OllamaState, OllamaModel } from "./types";

type StateChangeCallback = (state: OllamaState, models?: OllamaModel[], error?: string) => void;

let pollTimer: number | null = null;
let currentBackoff = 2000;
let checkSeq = 0;
const MAX_BACKOFF = 30000;
const ONLINE_INTERVAL = 10000;

interface HealthMonitorDeps {
  getProviderAndModels: typeof ollamaClient.getProviderAndModels;
  onOnline?: () => void;
  onOffline?: (error: string) => void;
}

function createHealthMonitor(deps: HealthMonitorDeps) {
  let currentState: OllamaState = "loading";
  let isStarted = false;
  const callbacks: Set<StateChangeCallback> = new Set();

  const notify = (state: OllamaState, models?: OllamaModel[], error?: string) => {
    currentState = state;
    callbacks.forEach((cb) => cb(state, models, error));
  };

  const scheduleNext = () => {
    const interval = currentState === "online" ? ONLINE_INTERVAL : currentBackoff;
    pollTimer = window.setTimeout(checkHealth, interval);
  };

  const checkHealth = async () => {
    const seq = ++checkSeq;

    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    try {
      const result = await deps.getProviderAndModels();
      if (seq !== checkSeq) return;

      if (!result.online) {
        notify("offline", undefined, "No active provider");
      } else {
        if (currentState !== "online") {
          deps.onOnline?.();
          currentBackoff = 2000;
        }

        notify("online", result.models);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isProviderError =
        errorMsg.includes("No available LLM providers") ||
        errorMsg.includes("No active provider");

      if (currentState === "online" && !isProviderError) {
        deps.onOffline?.(errorMsg);
      }

      notify(
        isProviderError || currentState === "loading" ? "offline" : "reconnecting",
        undefined,
        errorMsg,
      );

      currentBackoff = isProviderError
        ? 2000
        : Math.min(currentBackoff * 1.5, MAX_BACKOFF);
    }

    if (seq !== checkSeq || !isStarted) return;
    scheduleNext();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void checkHealth();
    }
  };

  const onWindowFocus = () => {
    void checkHealth();
  };

  return {
    getState: () => currentState,

    onStateChange(callback: StateChangeCallback): () => void {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },

    start() {
      if (isStarted) return;
      isStarted = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("focus", onWindowFocus);
      pollTimer = 1;
      void checkHealth();
    },

    stop() {
      if (!isStarted) return;
      isStarted = false;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
    },

    async refresh() {
      await checkHealth();
    },
  };
}

export type HealthMonitor = ReturnType<typeof createHealthMonitor>;

let monitor: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (!monitor) {
    monitor = createHealthMonitor({
      getProviderAndModels: ollamaClient.getProviderAndModels,
    });
  }
  return monitor;
}
