import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Cpu, Link2, Search, Settings2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { agentStatus } from "@/features/coding-agents/client";
import { connectionsClient } from "@/features/connections/client";
import { useConnectionsStore } from "@/features/connections/store";
import { getCurrentProviderAccountId } from "@/features/providers";
import {
  filterRuntimeOptions,
  groupRuntimeOptions,
  isExternalOption,
  isLocalOption,
  moveRuntimeHighlight,
  type RuntimeOption,
} from "@/features/runtime/runtime-options";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import { useChatStore } from "@/store/chatStore";

type ModelTab = "all" | "local" | "external";
const TABS: { id: ModelTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "local", label: "Local" },
  { id: "external", label: "External" },
];

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 28;

type FlatRow =
  | { kind: "header"; label: string; id: string }
  | { kind: "option"; option: RuntimeOption; id: string };

interface ModelSelectorProps {
  onManageConnections?: () => void;
}

const optionId = (runtime: RuntimeRef) =>
  runtime.kind === "chat-model"
    ? `model:${runtime.connection_id}:${runtime.model_id}`
    : runtime.kind === "coding-agent"
      ? `agent:${runtime.agent_kind}`
      : `unresolved:${runtime.reason}`;

export function ModelSelector({
  onManageConnections,
}: ModelSelectorProps) {
  const accountId = getCurrentProviderAccountId();
  const { summaries, models, loading, actions } = useConnectionsStore(
    useShallow((state) => ({
      summaries: state.summaries,
      models: state.models,
      loading: state.loading,
      actions: state.actions,
    })),
  );
  const selected = useRuntimeStore((state) => state.selected);
  const selectedLabel = useRuntimeStore((state) => state.label);
  const selectRuntime = useRuntimeStore((state) => state.actions.select);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ModelTab>("all");
  const [agents, setAgents] = useState<RuntimeOption[]>([]);
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    void (async () => {
      await actions.load(accountId);
      const state = useConnectionsStore.getState();
      const refreshModels = Promise.allSettled(
        state.summaries
          .filter((item) => item.connection.enabled && item.health.status !== "failed")
          .map((item) => state.actions.loadModels(item.connection.id, true)),
      );
      const [codex, claude, recents] = await Promise.all([
        agentStatus("codex"),
        agentStatus("claude-code"),
        connectionsClient.recents(accountId),
      ]);
      setAgents([
        {
          id: "agent:codex",
          family: "coding-agent",
          group: "Coding agents",
          title: "Codex",
          connection: "Local CLI",
          available: codex.installed && codex.authenticated,
          runtime: null,
        },
        {
          id: "agent:claude-code",
          family: "coding-agent",
          group: "Coding agents",
          title: "Claude Code",
          connection: "Local CLI",
          available: claude.installed && claude.authenticated,
          runtime: null,
        },
      ]);
      setRecentIds(new Set(recents.map(optionId)));
      await refreshModels;
    })();
  }, [accountId, actions, open]);

  const options = useMemo<RuntimeOption[]>(() => {
    const connectionOptions = summaries.flatMap((summary) =>
      (models[summary.connection.id] ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({
          id: `model:${summary.connection.id}:${item.remote_id}`,
          family: "chat-model" as const,
          group: ["ollama", "lmstudio"].includes(summary.connection.provider)
            ? "Local models" as const
            : "Cloud models" as const,
          title: item.display_name || item.remote_id,
          connection: summary.connection.display_name,
          available: summary.connection.enabled && summary.health.status !== "failed",
          runtime: {
            kind: "chat-model" as const,
            connection_id: summary.connection.id,
            model_id: item.remote_id,
          },
        })),
    );
    return [...agents, ...connectionOptions];
  }, [agents, models, summaries]);

  const tabbedOptions = useMemo(() => {
    if (tab === "external") return options.filter(isExternalOption);
    if (tab === "local") return options.filter(isLocalOption);
    return options;
  }, [options, tab]);

  const rows = useMemo<FlatRow[]>(
    () => groupRuntimeOptions(filterRuntimeOptions(tabbedOptions, query), recentIds)
      .flatMap(([group, items]) => [
        { kind: "header" as const, label: group, id: `header:${group}` },
        ...items.map((option) => ({ kind: "option" as const, option, id: option.id })),
      ]),
    [tabbedOptions, query, recentIds],
  );
  const optionRows = rows.filter((row): row is Extract<FlatRow, { kind: "option" }> => row.kind === "option");
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => rows[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT,
    overscan: 8,
    useFlushSync: false,
  });

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const workspaceFor = async (agent: "codex" | "claude-code") => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const chosen = await openDialog({
      directory: true,
      multiple: false,
      title: `Choose a workspace for ${agent === "codex" ? "Codex" : "Claude Code"}`,
    });
    if (typeof chosen !== "string") return null;
    const path = chosen;
    return connectionsClient.saveWorkspace({
      id: crypto.randomUUID(),
      account_id: accountId,
      path,
      display_name: path.split(/[\\/]/).pop() || path,
      last_validated_at: null,
      availability: "unknown",
    });
  };

  const materialize = async (option: RuntimeOption): Promise<RuntimeRef | null> => {
    if (option.runtime) return option.runtime;
    const agent = option.id === "agent:codex" ? "codex" : "claude-code";
    const workspace = await workspaceFor(agent);
    if (!workspace) return null;
    return {
      kind: "coding-agent",
      installation_id: agent,
      agent_kind: agent,
      workspace_id: workspace.id,
      agent_session_id: null,
    };
  };

  const applySelection = async (option: RuntimeOption) => {
    const runtime = await materialize(option);
    if (!runtime) return;
    if (activeConversationId) await connectionsClient.setRuntime(activeConversationId, runtime);
    selectRuntime(runtime, option.title);
    setOpen(false);
  };

  const choose = async (option: RuntimeOption) => {
    if (!option.available) {
      onManageConnections?.();
      setOpen(false);
      return;
    }
    await applySelection(option);
  };

  const move = (offset: number) => {
    if (!optionRows.length) return;
    const next = moveRuntimeHighlight(highlighted, offset, optionRows.length);
    setHighlighted(next);
    const rowIndex = rows.findIndex((row) => row.id === optionRows[next].id);
    virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Select model. Current: ${selectedLabel || "none"}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="h-7 max-w-[220px] justify-start gap-1 border-transparent bg-transparent px-0 text-left text-sm shadow-none hover:bg-transparent hover:text-foreground/80"
          >
            <span className="truncate text-sm font-medium">
              {selectedLabel || "Select a model"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(calc(100vw-1.5rem),28rem)] gap-0 overflow-hidden p-0 sm:w-[26rem]"
        >
          <div className="flex h-11 items-center gap-2 border-b border-border/60 px-3">
            <Search size={16} className="text-muted-foreground" />
            <Input
              autoFocus
              aria-label="Search models and agents"
              placeholder="Search a model"
              value={query}
              className="h-full border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Enter" && optionRows[highlighted]) {
                  event.preventDefault();
                  void choose(optionRows[highlighted].option);
                }
              }}
            />
          </div>
          <div role="tablist" aria-label="Model source" className="flex flex-wrap gap-1 border-b border-border/60 p-1">
            {TABS.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "h-auto rounded-xl bg-transparent px-3 py-1.5 text-xs text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground",
                  tab === item.id && "bg-accent text-foreground",
                )}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {loading && !rows.length ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : rows.length ? (
            <div ref={listRef} role="listbox" className="max-h-72 overflow-y-auto">
              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 top-0 w-full"
                      style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {row.kind === "header" ? (
                        <div className="px-3 pt-2 text-[0.6875rem] font-medium text-muted-foreground">{row.label}</div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          role="option"
                          aria-selected={selected ? optionId(selected) === row.option.id : false}
                          className={cn(
                            "flex h-full w-full items-center justify-between gap-3 px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted",
                            optionRows[highlighted]?.id === row.id && "bg-muted",
                          )}
                          onMouseEnter={() => setHighlighted(optionRows.findIndex((item) => item.id === row.id))}
                          onClick={() => void choose(row.option)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {row.option.family === "coding-agent" ? (
                              <Bot size={16} className="shrink-0" />
                            ) : (
                              <Cpu size={16} className="shrink-0" />
                            )}
                            <span className="truncate">{row.option.title}</span>
                            {isExternalOption(row.option) ? (
                              <Link2 size={14} className="shrink-0 text-muted-foreground" />
                            ) : null}
                            {!row.option.available ? <Badge variant="secondary">Set up</Badge> : null}
                          </span>
                          {selected && optionId(selected) === row.option.id ? (
                            <Check size={16} className="shrink-0" />
                          ) : null}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matching runtimes</div>
          )}
          <Button variant="ghost" className="w-full justify-start rounded-none border-t" onClick={() => { setOpen(false); onManageConnections?.(); }}>
            <Settings2 data-icon="inline-start" />
            Manage connections
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
}
