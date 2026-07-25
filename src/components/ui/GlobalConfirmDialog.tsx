import { useConfirmStore } from "@/store/confirmStore";
import { ConfirmDialog } from "./ConfirmDialog";

export function GlobalConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const { dismiss } = useConfirmStore((s) => s.actions);

  return (
    <ConfirmDialog
      open={Boolean(pending)}
      onOpenChange={(open) => { if (!open) dismiss(); }}
      title={pending?.title ?? ""}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel}
      destructive={pending?.destructive}
      onConfirm={() => pending?.onConfirm()}
    />
  );
}
