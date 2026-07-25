import type { ReactNode } from "react";
import { memo } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  AdvancedSettingsNavItem,
  SettingsTabDefinition,
  SettingsTabId,
} from "./settingsRegistry";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function SettingsDialog({ open, onOpenChange, children }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Capped, not viewport-filling. Width stops at 1200px because the
        // panel body is max-w-4xl (896px) + px-7 (56px) alongside the 260px
        // nav — past that the extra width is empty gutter. Height subtracts
        // the title bar as well as the margin: at `100dvh - 4rem` a centred
        // dialog put its top edge at 32px, under the 36px title bar.
        className="grid h-[min(760px,calc(100dvh-var(--titlebar-height)-4rem))] w-[min(1200px,calc(100vw-4rem))] max-w-none sm:max-w-none grid-cols-1 gap-0 overflow-hidden rounded-[min(var(--radius-4xl),24px)] border-border/60 bg-card p-0 shadow-2xl md:grid-cols-[260px_minmax(0,1fr)]"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

type SettingsSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export const SettingsSearch = memo(function SettingsSearch({ value, onChange }: SettingsSearchProps) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search settings"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search"
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Clear settings search" onClick={() => onChange("")}>
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
});

type SettingsNavItemProps = {
  item: SettingsTabDefinition | AdvancedSettingsNavItem;
  active?: boolean;
  onClick: () => void;
};

export const SettingsNavItem = memo(function SettingsNavItem({ item, active = false, onClick }: SettingsNavItemProps) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
});

type SettingsSidebarProps = {
  tabs: SettingsTabDefinition[];
  activeTab: SettingsTabId;
  query: string;
  advancedItem: AdvancedSettingsNavItem;
  onQueryChange: (value: string) => void;
  onSelectTab: (tab: SettingsTabId) => void;
  onOpenAdvanced: () => void;
};

export function SettingsSidebar({
  tabs,
  activeTab,
  query,
  advancedItem,
  onQueryChange,
  onSelectTab,
  onOpenAdvanced,
}: SettingsSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 bg-muted/30 p-3 md:border-r md:border-b-0">
      <div className="flex flex-col gap-3">
        <div className="px-1">
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        </div>
        <SettingsSearch value={query} onChange={onQueryChange} />
      </div>
      <ScrollArea className="mt-3 min-h-0 flex-1">
        <nav className="flex flex-col gap-1 pr-1" aria-label="Settings sections">
          {tabs.map((tab) => (
            <SettingsNavItem
              key={tab.id}
              item={tab}
              active={activeTab === tab.id}
              onClick={() => onSelectTab(tab.id)}
            />
          ))}
        </nav>
      </ScrollArea>
      <Separator className="my-3" />
      <SettingsNavItem item={advancedItem} onClick={onOpenAdvanced} />
    </aside>
  );
}

type SettingsPanelProps = {
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
};

export function SettingsPanel({ onClose, footer, children }: SettingsPanelProps) {
  return (
    <section className="relative flex min-h-0 flex-col bg-card">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close settings"
        className="absolute right-5 top-4 z-10"
      >
        <X />
      </Button>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-7 pb-7 pt-20">{children}</div>
      </ScrollArea>
      {footer ? <footer className="border-t border-border/60 px-5 py-3">{footer}</footer> : null}
    </section>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}

export function SettingRow({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-background/50 p-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0 sm:pt-0.5">{action}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function SettingControlGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
