import { useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@/components/ui/Box";
import { ButtonBase } from "@/components/ui/button-base";
import { InputBase } from "@/components/ui/input-base";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Typography } from "@/components/ui/Typography";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Search } from "lucide-react";
import { useOllama, type OllamaModel } from "@/features/ollama";
import { useProviderStore } from "@/features/providers";
import type { ModelProvider } from "@/store/modelStore";
import { modelChoiceId } from "@/lib/models/model-choice";
import {
  filterModelOptions,
  shouldLoadExternalModels,
  type ModelFilter,
} from "@/lib/models/model-selector";
import {
  ModelSelectorOption,
  ModelSelectorSkeleton,
  ModelSelectorStatus,
} from "@/features/chat/components/ModelSelectorOption";

const ROW_HEIGHT = 40;
const FILTERS: { id: ModelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "local", label: "Local" },
  { id: "external", label: "External" },
];

interface ModelSelectorProps {
  model: string;
  provider: ModelProvider;
  providerConfigId?: number;
  onChange: (option: OllamaModel) => void;
}

export function ModelSelector({
  model,
  provider,
  providerConfigId,
  onChange,
}: ModelSelectorProps) {
  const ollama = useOllama();
  const providers = useProviderStore((state) => state.providers);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<ModelFilter>("all");
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const externalApiUrl =
    providers.find((item) => item.provider_type === "OpenAICompatible")?.config
      .api_base_url ?? "OpenAI-compatible API";
  const visibleModels = useMemo(
    () => filterModelOptions(ollama.models, filter, query),
    [filter, ollama.models, query],
  );
  const selectedId = modelChoiceId(provider, model, providerConfigId);
  const rowVirtualizer = useVirtualizer({
    count: visibleModels.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    initialRect: { width: 480, height: 280 },
    overscan: 6,
    useFlushSync: false,
  });

  useEffect(() => {
    if (
      shouldLoadExternalModels(
        isOpen,
        ollama.externalModelsLoaded,
        ollama.externalModelsLoading,
      )
    ) {
      void ollama.actions.loadExternalModels();
    }
  }, [
    isOpen,
    ollama.actions,
    ollama.externalModelsLoaded,
    ollama.externalModelsLoading,
  ]);

  useEffect(() => {
    setHighlightedIndex(0);
    rowVirtualizer.scrollToIndex(0);
  }, [filter, query, rowVirtualizer]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          rowVirtualizer.measure();
        });
      });
    }
  }, [isOpen, rowVirtualizer]);

  const close = () => setIsOpen(false);

  const resetClosedState = () => {
    setFilter("all");
    setQuery("");
    setHighlightedIndex(0);
  };

  const select = (option: OllamaModel) => {
    onChange(option);
    close();
  };

  const moveHighlight = (offset: number) => {
    if (!visibleModels.length) return;
    const next =
      (highlightedIndex + offset + visibleModels.length) %
      visibleModels.length;
    setHighlightedIndex(next);
    rowVirtualizer.scrollToIndex(next, { align: "auto" });
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) resetClosedState();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Select model. Current model: ${model || "none"}`}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-md border border-transparent bg-transparent px-0 text-left text-sm text-foreground outline-none transition-colors hover:text-foreground/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <Typography as="span" noWrap className="text-sm font-medium">
            {model || "Select a model"}
          </Typography>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(calc(100vw-1.5rem),28rem)] gap-0 overflow-hidden p-0 sm:w-[26rem]"
      >
        <Box className="flex h-11 items-center gap-2 border-b border-border/60 px-3">
          <Search size={16} />
          <InputBase
            autoFocus
            fullWidth
            placeholder="Search a model"
            className="h-full text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveHighlight(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveHighlight(-1);
              } else if (event.key === "Enter" && visibleModels[highlightedIndex]) {
                select(visibleModels[highlightedIndex]);
              } else if (event.key === "Escape") {
                close();
              }
            }}
            inputProps={{ "aria-label": "Search models" }}
          />
        </Box>

        <Box role="tablist" aria-label="Model source" className="flex flex-wrap gap-1 border-b border-border/60 p-1">
          {FILTERS.map((item) => (
            <ButtonBase
              key={item.id}
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className="rounded-xl bg-transparent px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-[var(--dur-fast)] ease-[var(--ease-soft)] hover:bg-muted/60 hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
            >
              {item.label}
            </ButtonBase>
          ))}
        </Box>

        {ollama.state === "loading" || (ollama.externalModelsLoading && visibleModels.length === 0) ? (
          <ModelSelectorSkeleton count={4} />
        ) : visibleModels.length === 0 ? (
          <ModelSelectorStatus
            text={
              filter === "external" && ollama.externalModelsError
                ? "External models unavailable"
                : "No matching models"
            }
          />
        ) : (
          <Box ref={listRef} role="listbox" className="max-h-72 overflow-y-auto">
            <Box className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const option = visibleModels[virtualRow.index];
                return (
                  <ModelSelectorOption
                    key={modelChoiceId(option.provider_type, option.name, option.provider_config_id)}
                    option={option}
                    selected={modelChoiceId(option.provider_type, option.name, option.provider_config_id) === selectedId}
                    highlighted={virtualRow.index === highlightedIndex}
                    externalApiUrl={externalApiUrl}
                    onHover={() => setHighlightedIndex(virtualRow.index)}
                    onSelect={() => select(option)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
            </Box>
          </Box>
        )}
      </PopoverContent>
    </Popover>
  );
}
