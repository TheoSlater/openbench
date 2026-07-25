import type { SystemPrompt } from "@/store/modelStore";
import { useAuthStore } from "@/store/authStore";
import { useModelStore } from "@/store/modelStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useOllamaStore } from "@/features/ollama/monitor";
import { initStoreCoordinator } from "@/store/coordinator";
import { initRepository } from "@/lib/repositories";
import { startUpdateChecker } from "@/store/updateStore";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { backupCorruptStorageItem, startupError, startupPhase } from "@/lib/utils/startupDiagnostics";
import { IS_LINUX } from "@/lib/utils/platform";
import { cefViewportIsEnabled } from "@/features/viewport/native";

const SYSTEM_PROMPTS_STORAGE_KEY = "polyui.systemPrompts";

type StoredPrompts = {
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
};

let startupPromise: Promise<void> | null = null;

function restoreSystemPrompts() {
  try {
    const raw = localStorage.getItem(SYSTEM_PROMPTS_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as StoredPrompts;
    if (!Array.isArray(parsed.systemPrompts)) return;

    useModelStore.setState({
      systemPrompts: parsed.systemPrompts,
      activeSystemPromptId:
        parsed.activeSystemPromptId ?? parsed.systemPrompts[0]?.id ?? null,
    });
    startupPhase("system prompts restored");
  } catch (error) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SYSTEM_PROMPTS_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw) {
      backupCorruptStorageItem(SYSTEM_PROMPTS_STORAGE_KEY, raw, error);
    }
  }
}

function startSystemPromptPersistence() {
  if (window.__polyuiSystemPromptUnsubscribe) return;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  window.__polyuiSystemPromptUnsubscribe = useModelStore.subscribe(
    (state) => {
      if (timeoutId) clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(
            SYSTEM_PROMPTS_STORAGE_KEY,
            JSON.stringify({
              systemPrompts: state.systemPrompts,
              activeSystemPromptId: state.activeSystemPromptId,
            }),
          );
        } catch {}
      }, 300);
    },
  );
}

async function preloadVisibleAppChunks() {
  startupPhase("preload visible chunks start");
  await Promise.all([
    import("@/features/auth/AuthModal"),
    import("@/features/release-notes/ReleaseNotesModal"),
  ]);
  startupPhase("preload visible chunks complete");
}

function runAfterStartup(callback: () => void) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 2500 });
    return;
  }
  globalThis.setTimeout(callback, 500);
}

/*
 * Database architecture:
 * - Frontend conversations/messages: tauri-plugin-sql via repositories/index.ts
 * - Backend users/sessions/provider_configs: sqlx via Rust connection.rs
 * - Both hit the same chat.db file (Windows app_data_dir == app_config_dir).
 * - See connection.rs for backend schema, repositories/index.ts for frontend.
 */
async function initializeStores() {
  startupPhase("initialize stores start");
  restoreSystemPrompts();
  startSystemPromptPersistence();

  if (IS_LINUX) {
    await cefViewportIsEnabled()
      .then((enabled) => {
        useSettingsStore.getState().actions.updateGeneral({
          experimentalChromiumBrowser: enabled,
        });
      })
      .catch((error) => startupError("CEF preference sync failed", error));
  }

  startupPhase("repository init start");
  await initRepository();
  startupPhase("repository init complete");
  startupPhase("store coordinator init start");
  initStoreCoordinator();
  startupPhase("store coordinator init complete");

  startupPhase("auth restore start");
  await useAuthStore.getState().actions.restoreSession().catch((err) => {
    startupError("Session restore failed", err);
    console.warn("[startup] Session restore failed:", err);
  });
  startupPhase("auth restore complete");

  const { isLoading } = useAuthStore.getState();
  if (isLoading) {
    useAuthStore.setState({ isLoading: false });
  }
  startupPhase("initialize stores complete");
}

async function initializeDeferredStartupWork() {
  startupPhase("deferred startup work start");

  startupPhase("notification permission start");
  void requestNotificationPermission();

  startupPhase("ollama monitor start");
  useOllamaStore.getState().actions.start();

  startupPhase("update checker init start");
  startUpdateChecker();
  startupPhase("update checker init complete");

  startupPhase("idle manager init start");
  const { idleManager, registerDefaultIdleHandlers } = await import("@/lib/idle");
  idleManager.start();
  registerDefaultIdleHandlers();
  startupPhase("idle manager init complete");

  startupPhase("deferred startup work complete");
}

async function requestNotificationPermission() {
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch {
    startupPhase("notification permission unavailable");
    // Notification permission not available (e.g. non-Tauri or Linux without .desktop file)
  }
}

export async function prepareAppStartup() {
  startupPromise ??= Promise.all([
    preloadVisibleAppChunks(),
    initializeStores(),
  ]).then(() => {
    runAfterStartup(() => {
      void initializeDeferredStartupWork().catch((err) => {
        startupError("Deferred startup work failed", err);
      });
    });
  });

  await startupPromise;
}

declare global {
  interface Window {
    __polyuiSystemPromptUnsubscribe?: () => void;
  }
}

export {};
