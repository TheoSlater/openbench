import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentIcon } from "@/features/coding-agents/AgentIcon";
import { connectionsClient } from "@/features/connections/client";
import { getCurrentProviderAccountId } from "@/features/providers";
import {
  filterRuntimeOptions,
  groupRuntimeOptions,
  moveRuntimeHighlight,
  runtimeOptionsFromCatalog,
  runtimeRefId,
  runtimeLabel,
  type RuntimeOption,
} from "@/features/runtime/runtime-options";
import { useRuntimeCatalogStore } from "@/features/runtime/catalog-store";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import type { RuntimeRef } from "@/generated/bindings/RuntimeRef";
import { useChatStore } from "@/store/chatStore";
import { devLog } from "@/features/debug-overlay/devLog";

type FlatRow =
  | { kind: "header"; label: string; id: string }
  | { kind: "option"; option: RuntimeOption; id: string };

interface ModelSelectorProps {
  onManageConnections?: () => void;
}

const AGENT_NAMES = { codex: "Codex", "claude-code": "Claude Code" } as const;

export function ModelSelector({
  onManageConnections,
}: ModelSelectorProps) {
  const accountId = getCurrentProviderAccountId();
  const { connections, modelsByConnection, agents, recentRuntimeIds, status, error, refreshing, actions } = useRuntimeCatalogStore(
    useShallow((state) => ({
      connections: state.connections,
      modelsByConnection: state.modelsByConnection,
      agents: state.agents,
      recentRuntimeIds: state.recentRuntimeIds,
      status: state.status,
      error: state.error,
      refreshing: state.refreshingConnectionIds.size > 0
        || Object.values(state.agents).some((agent) => agent.modelsState === "loading"),
      actions: state.actions,
    })),
  );
  const selected = useRuntimeStore((state) => state.selected);
  const selectedLabel = useRuntimeStore((state) => state.label);
  const selectRuntime = useRuntimeStore((state) => state.actions.select);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    if (accountId) void actions.start(accountId);
  }, [accountId, actions]);

  const options = useMemo<RuntimeOption[]>(
    () => runtimeOptionsFromCatalog(connections, modelsByConnection, agents),
    [agents, connections, modelsByConnection],
  );

  const rows = useMemo<FlatRow[]>(
    () => groupRuntimeOptions(filterRuntimeOptions(options, query), recentRuntimeIds)
      .flatMap(([group, items]) => [
        { kind: "header" as const, label: group, id: `header:${group}` },
        ...items.map((option) => ({ kind: "option" as const, option, id: option.id })),
      ]),
    [options, query, recentRuntimeIds],
  );
  const optionRows = rows.filter((row): row is Extract<FlatRow, { kind: "option" }> => row.kind === "option");
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const workspaceFor = async (agent: "codex" | "claude-code") => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const chosen = await openDialog({
      directory: true,
      multiple: false,
      title: `Choose a workspace for ${AGENT_NAMES[agent]}`,
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
    if (option.family !== "coding-agent") return null;
    const agent = option.id.startsWith("agent:codex") ? "codex" : "claude-code";
    const workspace = await workspaceFor(agent);
    if (!workspace) return null;
    return {
      kind: "coding-agent",
      installation_id: agent,
      agent_kind: agent,
      workspace_id: workspace.id,
      agent_session_id: null,
      model_id: option.modelId ?? null,
    };
  };

  const applySelection = async (option: RuntimeOption) => {
    const runtime = await materialize(option);
    if (!runtime) return;
    if (activeConversationId) {
      try {
        await connectionsClient.setRuntime(activeConversationId, runtime);
      } catch (error) {
        devLog("error", "runtime", "Failed to bind selected runtime to conversation", error);
      }
    }
    selectRuntime(runtime, runtimeLabel(runtime));
    setOpen(false);
  };

  const choose = async (option: RuntimeOption) => {
    if (option.status === "checking") return;
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
    requestAnimationFrame(() => {
      document.getElementById(`runtime-option-${optionRows[next].id}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button
            variant="ghost"
            size="sm"
            aria-label={`Select model. Current: ${selectedLabel || "none"}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="h-7 max-w-[220px] justify-start gap-1 border-transparent bg-transparent px-0 text-left text-sm shadow-none hover:bg-transparent hover:text-foreground/80"
          />}
        >
            <span className="truncate text-sm font-medium">
              {selectedLabel || "Select a model"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
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
              aria-activedescendant={optionRows[highlighted] ? `runtime-option-${optionRows[highlighted].id}` : undefined}
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
            {refreshing ? (
              <LoaderCircle className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-label="Refreshing models" />
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label="Refresh model catalog"
                onClick={() => void actions.refresh()}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
          {status === "loading" && !rows.length ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : rows.length ? (
            <div role="listbox" className="max-h-72 overflow-y-auto">
              {rows.map((row) => row.kind === "header" ? (
                <div key={row.id} className="flex h-7 items-end px-3 pb-1 text-[0.6875rem] font-medium text-muted-foreground">
                  {row.label}
                </div>
              ) : (
                <Button
                  key={row.id}
                  id={`runtime-option-${row.id}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={selected ? runtimeRefId(selected) === row.option.id : false}
                  aria-disabled={row.option.status === "checking"}
                  className={cn(
                    "flex h-12 w-full items-center justify-between gap-3 rounded-none px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted",
                    optionRows[highlighted]?.id === row.id && "bg-muted",
                    row.option.status === "checking" && "cursor-default text-muted-foreground hover:bg-transparent",
                  )}
                  onMouseEnter={() => setHighlighted(optionRows.findIndex((item) => item.id === row.id))}
                  onClick={() => void choose(row.option)}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {row.option.agentKind ? (
                      <AgentIcon kind={row.option.agentKind} className="size-[18px]" />
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate leading-5">{row.option.title}</span>
                      <span className="truncate text-xs leading-4 text-muted-foreground">{row.option.connection}</span>
                    </span>
                  </span>
                  {selected && runtimeRefId(selected) === row.option.id ? (
                    <Check size={16} className="shrink-0" />
                  ) : null}
                </Button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-7 text-center">
              <p className="text-sm font-medium text-foreground">
                {query ? "No matching models" : error ? "Models unavailable" : "No models connected"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {query ? "Try a different search." : error ? "Retry or manage your connections." : "Add a model connection to start chatting."}
              </p>
              {error && !query ? (
                <Button size="sm" variant="outline" className="mt-3" onClick={() => void actions.refresh()}>
                  Retry
                </Button>
              ) : null}
            </div>
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
