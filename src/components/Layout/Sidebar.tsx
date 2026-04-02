import { Settings, SquarePlus } from "lucide-react";

type SidebarProps = {
  onOpenSettings: () => void;
};

/**
 * Persistent left sidebar with primary actions.
 * @param onOpenSettings - Handler to open the settings modal.
 */
export function Sidebar({ onOpenSettings }: SidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border/60 bg-card">
      <div className="px-4 pb-2 pt-4">
        <span className="text-sm font-semibold text-foreground/90">
          OpenBench
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted/80"
          aria-label="New chat"
        >
          <SquarePlus className="size-4" />
          <span>New Chat</span>
        </button>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground/80 transition hover:border-border hover:text-foreground"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
        </button>
      </div>

      <div className="flex-1 px-4 pb-4 pt-4">
        <p className="text-xs text-muted-foreground/60">Chat history coming soon</p>
      </div>
    </aside>
  );
}
