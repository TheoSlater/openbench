import { useNotificationStore, type ToastType } from "@/store/notificationStore";
import { useCallback, useMemo } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { devLog } from "@/features/debug-overlay/devLog";

export function useNotify() {
  const add = useNotificationStore((s) => s.actions.add);
  const startRemove = useNotificationStore((s) => s.actions.startRemove);
  const update = useNotificationStore((s) => s.actions.update);

  const notificationsEnabled = useSettingsStore((s) => s.general.notifications);

  const tryAdd = useCallback(
    (toast: Omit<import("@/store/notificationStore").Toast, "id">) => {
      if (toast.type === "error" || toast.type === "warning") {
        devLog(toast.type === "error" ? "error" : "warn", "notification", "Toast shown", {
          messageLength: toast.message.length,
          descriptionLength: toast.description?.length ?? 0,
        });
      }
      if (!notificationsEnabled) return "";
      return add(toast);
    },
    [notificationsEnabled, add]
  );

  const notify = useCallback(
    (message: string, type: ToastType = "info", options?: { description?: string; duration?: number }) => {
      return tryAdd({ message, type, ...options });
    },
    [tryAdd]
  );

  const success = useCallback((msg: string, desc?: string) => tryAdd({ message: msg, description: desc, type: "success" }), [tryAdd]);
  const error = useCallback((msg: string, desc?: string) => tryAdd({ message: msg, description: desc, type: "error", duration: 5000 }), [tryAdd]);
  const warn = useCallback((msg: string, desc?: string) => tryAdd({ message: msg, description: desc, type: "warning" }), [tryAdd]);
  const info = useCallback((msg: string, desc?: string) => tryAdd({ message: msg, description: desc, type: "info" }), [tryAdd]);

  const promise = useCallback(
    async <T>(
      p: Promise<T>,
      msgs: { loading: string; success: string | ((data: T) => string); error: string | ((err: any) => string) }
    ): Promise<T> => {
      if (!notificationsEnabled) return p;
      const id = add({ message: msgs.loading, type: "loading", duration: Infinity });
      try {
        const result = await p;
        const successMsg = typeof msgs.success === "function" ? msgs.success(result) : msgs.success;
        update(id, { message: successMsg, type: "success", duration: 3000 });
        return result;
      } catch (err) {
        const errorMsg = typeof msgs.error === "function" ? msgs.error(err) : msgs.error;
        devLog("error", "notification", "Promise notification failed", {
          messageLength: errorMsg.length,
          error: err,
        });
        update(id, { message: errorMsg, type: "error", duration: 5000 });
        throw err;
      }
    },
    [notificationsEnabled, add, update]
  );

  // Stable identity: effects that list the returned object as a dependency
  // must not re-run (cancelling in-flight fetches) on every render.
  return useMemo(
    () => ({ notify, success, error, warn, info, promise, dismiss: startRemove }),
    [notify, success, error, warn, info, promise, startRemove],
  );
}
