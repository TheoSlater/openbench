import * as React from "react";
import {
  AlertTriangle,
  Check,
  MessageSquare,
  Settings,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { CommandPaletteCategory, CommandPaletteItem } from "./types";
import { getIntentSummary, parseCommandIntent, type ParsedIntent } from "./intentParser";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
};

const MEDIUM_CONFIDENCE = 0.62;

const CATEGORY_LABELS: Record<CommandPaletteCategory, string> = {
  action: "Actions",
  conversation: "Conversations",
  feature: "Features",
  setting: "Settings",
};

const CATEGORY_ORDER: CommandPaletteCategory[] = [
  "action",
  "conversation",
  "feature",
  "setting",
];

function scoreItem(item: CommandPaletteItem, query: string) {
  const haystack = [item.title, item.description, item.category, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  if (haystack.includes(needle)) return 1000 - haystack.indexOf(needle);
  let score = 0;
  let hi = 0;
  for (const ch of needle) {
    const fi = haystack.indexOf(ch, hi);
    if (fi === -1) return 0;
    score += fi === hi ? 12 : 4;
    hi = fi + 1;
  }
  return score - haystack.length * 0.01;
}

function buildGroups(items: CommandPaletteItem[], query: string) {
  const trimmed = query.trim();
  const minScore = Math.max(16, trimmed.length * 8);
  const source = trimmed
    ? items.map((item) => ({ item, score: scoreItem(item, trimmed) }))
        .filter((e) => e.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .map((e) => e.item)
    : items;

  const groups: {
    category: CommandPaletteCategory;
    label: string;
    items: CommandPaletteItem[];
  }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const group = source.filter((i) => i.category === cat);
    if (!group.length) continue;
    groups.push({ category: cat, label: CATEGORY_LABELS[cat], items: group });
  }
  return groups;
}

function catIcon(category: CommandPaletteCategory) {
  if (category === "conversation") return <MessageSquare size={16} />;
  if (category === "feature") return <Zap size={16} />;
  if (category === "setting") return <Settings size={16} />;
  return <Sparkles size={16} />;
}

export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");

  const groups = React.useMemo(() => buildGroups(items, query), [items, query]);
  const parsedIntent = React.useMemo(() => parseCommandIntent(query), [query]);
  const showIntent = Boolean(
    parsedIntent && (parsedIntent.confidence >= MEDIUM_CONFIDENCE || parsedIntent.destructive),
  );

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()));
  }, [open]);

  const execute = React.useCallback(
    (item?: CommandPaletteItem) => {
      if (!item) return;
      item.execute();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const executeIntent = React.useCallback((intent: ParsedIntent | null) => {
    if (!intent) return;
    if (intent.command === "search-chats") {
      setQuery(intent.args.query);
      requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()));
      return;
    }
    const action = items.find((i) => i.smartCommand?.command === intent.command);
    if (!action) return;
    const exec = action.smartCommand?.execute;
    if (exec) {
      void exec(intent.args as never);
    } else {
      action.execute();
    }
    onOpenChange(false);
  }, [items, onOpenChange]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (e.key === "Enter" && parsedIntent && showIntent) {
      e.preventDefault();
      executeIntent(parsedIntent);
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      className="mx-4 flex max-h-[min(560px,72vh)] w-full max-w-[600px] flex-col gap-0 bg-popover p-0 shadow-2xl sm:max-w-[600px]"
    >
      <Command
        shouldFilter={false}
        onKeyDown={onKeyDown}
        className="rounded-[min(var(--radius-4xl),24px)] bg-popover p-0"
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          placeholder="Type a command or search…"
          aria-label="Search commands"
          className="placeholder:text-muted-foreground/60"
        />

        {showIntent && parsedIntent ? (
          <div className={cn(
            "flex items-center gap-2 px-5 py-2 text-xs",
            parsedIntent.destructive ? "text-destructive" : "text-muted-foreground",
          )}>
            {parsedIntent.destructive ? <AlertTriangle size={12} /> : <Sparkles size={12} />}
            <span className="truncate">
              {formatIntentSummary(parsedIntent)}
            </span>
          </div>
        ) : null}

        <CommandList
          aria-label="Command results"
          className="min-h-0 max-h-none flex-1 px-2 pb-3"
        >
          <CommandEmpty className="py-10 text-muted-foreground">No results</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup
              key={group.category}
              heading={group.label}
              className="p-0 pt-2 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:pt-0 **:[[cmdk-group-heading]]:font-normal **:[[cmdk-group-heading]]:text-muted-foreground/60"
            >
              {group.items.map((item) => (
                <CmdRow key={item.id} item={item} onSelect={() => execute(item)} />
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function CmdRow({ item, onSelect }: {
  item: CommandPaletteItem;
  onSelect: () => void;
}) {
  const isFeature = item.category === "feature";
  const isOn = item.title.startsWith("✓");
  const title = isFeature ? item.title.replace(/^[✓✕]\s*/, "") : item.title;

  return (
    <CommandItem
      value={item.id}
      onSelect={onSelect}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left",
        "data-selected:bg-accent hover:bg-accent/50",
      )}
    >
      <span className="shrink-0 text-muted-foreground [&>svg]:size-[15px]">
        {item.icon ?? catIcon(item.category)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      {item.shortcut?.length ? (
        <KbdGroup className="ml-auto">
          {item.shortcut.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      ) : null}
      {isFeature ? (
        <span className={isOn ? "text-success" : "text-muted-foreground/40"}>
          {isOn ? <Check size={14} /> : <X size={14} />}
        </span>
      ) : null}
    </CommandItem>
  );
}

function formatIntentSummary(intent: ParsedIntent) {
  const summary = getIntentSummary(intent);
  return `${summary.action}${summary.argument ? ` "${summary.argument}"` : ""}`;
}
