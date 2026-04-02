import { PersonalizationPanel } from "./PersonalizationPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import {
  Settings,
  UserCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export interface PersonalizationPanelRef {
  handleSave: () => boolean;
  handleSaveAsNew: () => boolean;
}

const SIDEBAR_ITEMS = [
  { id: "general", label: "General", icon: Settings },
  { id: "personalization", label: "Personalization", icon: UserCircle },
];

/**
 * Settings modal overlay with ChatGPT-style sidebar navigation.
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const personalizationRef = useRef<PersonalizationPanelRef>(null);
  const [activeTab, setActiveTab] = useState("personalization");

  const handleSave = () => {
    if (personalizationRef.current?.handleSave()) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 z-50 flex h-[92vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-row overflow-hidden rounded-[1.25rem] border border-border/40 bg-background p-0 shadow-2xl transition-all sm:h-[80vh] min-w-0"
      >
        {/* Custom Close Button Top Left */}
        <div className="absolute top-4 left-4 z-50 md:hidden">
          <DialogClose render={<Button variant="ghost" size="icon" className="rounded-full" />}>
            <X className="size-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        {/* Left Sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border/10 bg-muted/10 px-3 py-6 md:block overflow-y-auto min-w-0 relative">
          <div className="mb-6 px-3">
            <DialogClose render={<Button variant="ghost" size="icon" className="rounded-full" />}>
              <X className="size-5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
          <nav className="space-y-1">
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  activeTab === item.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <header className="flex shrink-0 flex-col items-start justify-between gap-4 border-b border-border/10 px-6 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-10 sm:py-6">
            <div className="min-w-0 flex-1 space-y-0.5">
              <DialogTitle className="text-lg font-bold tracking-tight text-foreground sm:text-2xl">
                {SIDEBAR_ITEMS.find((i) => i.id === activeTab)?.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground/60 sm:text-sm">
                Manage your {activeTab} preferences and configuration.
              </DialogDescription>
            </div>
            <div className="flex w-full shrink-0 items-center justify-end gap-3 sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="rounded-xl px-4 text-xs font-semibold sm:px-6"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                className="rounded-xl bg-foreground px-5 text-xs font-bold text-background shadow-sm hover:bg-foreground/90 sm:px-8"
              >
                Save
              </Button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10 sm:py-10">
            {activeTab === "personalization" ? (
              <PersonalizationPanel ref={personalizationRef} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="rounded-full bg-muted/30 p-5">
                  <Settings className="size-10 text-muted-foreground/30" />
                </div>
                <h3 className="mt-5 text-base font-bold text-foreground">
                  Section under development
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground/50">
                  This part of the settings is coming soon.
                </p>
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
