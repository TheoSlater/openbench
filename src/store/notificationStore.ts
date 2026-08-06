import { create } from "zustand";
import { toast } from "@/components/ui/toast";

export type ToastType = "success" | "error" | "warning" | "info" | "loading";

const MAX_TOASTS = 5;
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
  loading: Infinity,
};

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationState {
  toasts: Toast[];
  actions: {
    add: (toast: Omit<Toast, "id">) => string;
    startRemove: (id: string) => void;
    remove: (id: string) => void;
    update: (id: string, updates: Partial<Toast>) => void;
    clear: () => void;
  };
}

function forgetToast(id: string): void {
  useNotificationStore.setState((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id),
  }));
}

function showToast(item: Toast): void {
  const options = {
    id: item.id,
    title: item.message,
    description: item.description,
    type: item.type,
    timeout: item.duration === Infinity ? 0 : item.duration,
    actionProps: item.action
      ? { children: item.action.label, onClick: item.action.onClick }
      : undefined,
    onClose: () => forgetToast(item.id),
    onRemove: () => forgetToast(item.id),
  };

  toast.add(options);
}

function dismissToast(id: string): void {
  if (!useNotificationStore.getState().toasts.some((toast) => toast.id === id)) return;
  toast.close(id);
  forgetToast(id);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  actions: {
    add: (input) => {
      const item = {
        ...input,
        id: crypto.randomUUID(),
        duration: input.duration ?? DEFAULT_DURATION[input.type],
      };
      const evicted: Toast[] = [];

      set((state) => {
        const next = [...state.toasts, item];
        // ponytail: keep five visible; add a queued history only if burst loss matters.
        while (next.length > MAX_TOASTS) {
          const transientIndex = next.findIndex((toast) => toast.type !== "loading");
          evicted.push(next.splice(transientIndex >= 0 ? transientIndex : 0, 1)[0]);
        }
        return { toasts: next };
      });

      evicted.forEach((evictedToast) => toast.close(evictedToast.id));
      showToast(item);
      return item.id;
    },
    startRemove: dismissToast,
    remove: dismissToast,
    update: (id, updates) => {
      const current = get().toasts.find((toast) => toast.id === id);
      if (!current) return;
      const next = { ...current, ...updates };
      set((state) => ({
        toasts: state.toasts.map((toast) => (toast.id === id ? next : toast)),
      }));
      showToast(next);
    },
    clear: () => {
      toast.close();
      set({ toasts: [] });
    },
  },
}));
