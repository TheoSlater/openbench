import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SHORTCUTS, SHORTCUT_GROUPS } from "./registry";

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(440px,calc(100vw-2rem))] max-w-none flex-col gap-4">
        <DialogTitle>Keyboard shortcuts</DialogTitle>

        {SHORTCUT_GROUPS.map((group) => {
          const items = SHORTCUTS.filter((shortcut) => shortcut.group === group);
          if (items.length === 0) return null;

          return (
            <section key={group} className="flex flex-col gap-1">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                {group}
              </h3>
              {items.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between gap-4 py-1"
                >
                  <span className="min-w-0 text-sm">{shortcut.label}</span>
                  <KbdGroup>
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                </div>
              ))}
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
