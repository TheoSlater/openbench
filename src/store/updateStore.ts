import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

type UpdateState = {
  status: UpdateStatus;
  version: string;
  stale: boolean;
  progress: number;
  downloadUrl: string | null;
  assetName: string | null;
  filePath: string | null;
  error: string | null;
};

type UpdateActions = {
  check: () => Promise<void>;
  install: () => Promise<void>;
};

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

let unlistenProgress: (() => void) | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let simulateInstall = false;

export function setUpdateInstallSimulation(enabled: boolean) {
  simulateInstall = enabled;
}

export const useUpdateStore = create<UpdateState & { actions: UpdateActions }>()(
  (set, get) => ({
    status: "idle",
    version: "",
    stale: false,
    progress: 0,
    downloadUrl: null,
    assetName: null,
    filePath: null,
    error: null,

    actions: {
      check: async () => {
        const { status } = get();
        if (status === "downloading" || status === "downloaded") return;
        set({ status: "checking", error: null });

        try {
          const info = await invoke<{
            has_update: boolean;
            version: string;
            download_url: string | null;
            asset_name: string | null;
            size: number | null;
          }>("check_for_updates");

          if (!info.has_update || !info.download_url || !info.asset_name) {
            set({ status: "idle", stale: false });
            return;
          }

          set({
            status: "available",
            stale: true,
            version: info.version,
            downloadUrl: info.download_url,
            assetName: info.asset_name,
          });

          set({ status: "downloading", progress: 0 });

          if (unlistenProgress) {
            unlistenProgress();
            unlistenProgress = null;
          }

          unlistenProgress = await listen<{
            status: string;
            percent: number;
            bytes: number;
            total: number;
            file_path: string | null;
            error: string | null;
          }>("update-progress", (event) => {
            const p = event.payload;
            if (p.status === "downloading") {
              set({
                status: "downloading",
                progress: Math.round(p.percent),
              });
            } else if (p.status === "downloaded") {
              set({
                status: "downloaded",
                progress: 100,
                filePath: p.file_path,
              });
            } else if (p.status === "error") {
              set({ status: "error", error: p.error ?? "Download failed" });
            }
          });

          await invoke("download_update", {
            url: info.download_url,
            assetName: info.asset_name,
          });
        } catch (err: any) {
          if (err === "rate_limited") {
            set({ status: "idle" });
            return;
          }
          set({ status: "error", error: typeof err === "string" ? err : (err?.message ?? "Check failed") });
        }
      },

      install: async () => {
        if (get().status !== "downloaded") return;
        set({ status: "installing", error: null });

        if (simulateInstall) {
          await new Promise((r) => setTimeout(r, 800));
          clearUpdateState();
          return;
        }

        try {
          await invoke("install_update");
        } catch (err: any) {
          set({ status: "error", error: typeof err === "string" ? err : (err?.message ?? "Install failed") });
        }
      },
    },
  }),
);

export function simulateUpdateProgress() {
  let pct = 0;
  const interval = setInterval(() => {
    pct += 5;
    useUpdateStore.setState({ status: "downloading", progress: pct });
    if (pct >= 100) {
      clearInterval(interval);
      useUpdateStore.setState({ status: "downloaded", progress: 100, filePath: "/tmp/test-update" });
    }
  }, 200);
}

export function clearUpdateState() {
  useUpdateStore.setState({
    status: "idle", version: "", stale: false, progress: 0,
    downloadUrl: null, assetName: null, filePath: null, error: null,
  });
}

export function startUpdateChecker() {
  const { actions } = useUpdateStore.getState();
  actions.check();

  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(() => {
    useUpdateStore.getState().actions.check();
  }, UPDATE_CHECK_INTERVAL);
}

export function stopUpdateChecker() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
}
