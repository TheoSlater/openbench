import { Command } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
        <Command size={24} className="text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        Select a model and start typing
      </p>
    </div>
  );
}