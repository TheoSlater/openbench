import React, { useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X, Loader2 } from "lucide-react";
import { useNotificationStore, type Toast as ToastType } from "@/store/notificationStore";
import { cn } from "@/lib/utils";

const typeIcon = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
};

const ToastItem = ({ toast, isRemoving }: { toast: ToastType; isRemoving: boolean }) => {
  const { startRemove, remove } = useNotificationStore((s) => s.actions);
  const Icon = typeIcon[toast.type] || Info;
  const tone =
    toast.type === "success"
      ? "border-success/25 text-success"
      : toast.type === "error"
        ? "border-destructive/25 text-destructive"
        : toast.type === "warning"
          ? "border-warning/25 text-warning"
          : "border-border/60 text-muted-foreground";

  useEffect(() => {
    if (toast.duration === Infinity || isRemoving) return;
    const timer = setTimeout(() => startRemove(toast.id), toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, isRemoving, startRemove]);

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto relative mb-3 flex w-[calc(100vw-32px)] max-w-[380px] items-start gap-3.5 rounded-xl border bg-card px-4 py-3.5 shadow-xl sm:w-[380px]",
        isRemoving ? "animate-toast-out" : "animate-toast-in",
        tone,
      )}
      onAnimationEnd={() => {
        if (isRemoving) remove(toast.id);
      }}
    >
      <div className="mt-1 shrink-0 leading-none">
        <Icon size={18} className={toast.type === "loading" ? "animate-spin" : undefined} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5 text-foreground">
          {toast.message}
        </p>
        {toast.description && (
          <p className="mt-1 block text-xs leading-[1.4] text-muted-foreground">
            {toast.description}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => startRemove(toast.id)}
        className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const toasts = useNotificationStore((s) => s.toasts);
  const removing = useNotificationStore((s) => s.removing);

  return (
    <>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-[var(--z-toast)] flex flex-col-reverse sm:right-6 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} isRemoving={removing.has(toast.id)} />
        ))}
      </div>
    </>
  );
};
