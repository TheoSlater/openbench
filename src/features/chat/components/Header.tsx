import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ModelProvider } from "@/store/modelStore";
import { useOllama } from "@/features/ollama";
import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CircularProgress } from "@/components/ui/spinner";
import { LinearProgress } from "@/components/ui/linear-progress";
import {
  X,
  Plus,
  AlertCircle,
  ScrollText,
  Check,
  Brain,
  PanelRightIcon,
} from "lucide-react";
import { PROMPT_PRESETS, type PromptPresetId } from "@/lib/constants/promptPresets";
import { useSettingsStore } from "@/store/settingsStore";
import { useChatStore } from "@/store/chatStore";
import { ModelSelector } from "@/features/chat/components/ModelSelector";
import type { ModelChoice } from "@/lib/models/model-choice";
import {
  MemoryPanel,
  setMemoryPanelOpen,
  useMemoryPanelOpen,
} from "@/features/memory/MemoryPanel";
import { useConversationMemoryCount } from "@/features/memory/useConversationMemoryCount";
import { openEmptyViewport, useViewportStore } from "@/features/viewport/viewportStore";


interface HeaderProps {
  selectedModels: string[];
  selectedProviders: ModelProvider[];
  selectedModelChoices: ModelChoice[];
  onModelChange: (
    index: number,
    provider: ModelProvider,
    model: string,
    providerConfigId?: number,
  ) => void;
  onAddModel: () => void;
  onRemoveModel: (index: number) => void;
  onSetDefault: (choice: ModelChoice) => void;
  isTemporary?: boolean;
  onToggleTemporaryChat: () => void;
}

export const Header = memo(function Header({
  selectedModels,
  selectedProviders,
  selectedModelChoices,
  onModelChange,
  onAddModel,
  onRemoveModel,
  onSetDefault,
  isTemporary,
  onToggleTemporaryChat,
}: HeaderProps) {
  const { selectedPromptPreset, actions } = useSettingsStore(
    useShallow((state) => ({
      selectedPromptPreset: state.selectedPromptPreset,
      actions: state.actions,
    })),
  );
  const ollama = useOllama();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const viewportDrawerOpen = useViewportStore((state) => state.drawerOpen);
  const memoryPanelOpen = useMemoryPanelOpen();
  const { count: memoryCount, refresh: refreshMemoryCount } = useConversationMemoryCount(
    activeConversationId ?? undefined,
  );

  const pullCompleted = ollama.pullProgress?.completed ?? 0;
  const pullTotal = ollama.pullProgress?.total ?? 0;
  const hasPullProgress =
    typeof ollama.pullProgress?.completed === "number" &&
    typeof ollama.pullProgress?.total === "number" &&
    pullTotal > 0;
  const pullProgressPercent = hasPullProgress
    ? Math.round((pullCompleted / pullTotal) * 100)
    : undefined;

  return (
    <Box
      as="header"
      className="relative z-20 flex h-16 shrink-0 items-start gap-3 px-5 pt-3"
    >
      <Box className="min-w-0 flex-1 overflow-hidden">
        <Box className="flex flex-col items-start">
          {ollama.pullingModel ? (
            <Box
              className="w-56"
            >
              <Box
                className="mb-1 flex items-center justify-between gap-2"
              >
                <Typography
                  variant="caption"
                >
                  Pulling {ollama.pullingModel}...
                </Typography>
                <Typography variant="caption">
                  {hasPullProgress
                    ? `${pullProgressPercent}%`
                    : (ollama.pullProgress?.status ?? "Starting...")}
                </Typography>
              </Box>
              <LinearProgress
                variant={hasPullProgress ? "determinate" : "indeterminate"}
                value={pullProgressPercent}
              />
            </Box>
          ) : (
            <>
              <Box
                className="flex min-w-0 items-center gap-2"
              >
                {selectedModels.length === 0 ? (
                  <ModelSelector
                    model=""
                    provider="OllamaLocal"
                    onChange={(option) =>
                      onModelChange(0, option.provider_type, option.name, option.provider_config_id)
                    }
                  />
                ) : null}
                {selectedModels.map((selectedModel, index) => (
                  <Box
                    key={`${selectedModel}-${index}`}
                    className="flex min-w-0 items-center gap-1"
                  >
                    <ModelSelector
                      model={selectedModel}
                      provider={selectedProviders[index] ?? "OllamaLocal"}
                      providerConfigId={selectedModelChoices[index]?.providerConfigId}
                      onChange={(option) =>
                        onModelChange(index, option.provider_type, option.name, option.provider_config_id)
                      }
                    />
                    {selectedModels.length > 1 && (
                      <IconButton
                        aria-label={`Remove ${selectedModel || "empty"} model selector`}
                        size="small"
                        onClick={() => onRemoveModel(index)}
                      >
                        <X size={14} />
                      </IconButton>
                    )}
                  </Box>
                ))}
                <IconButton
                  aria-label="Add model selector"
                  onClick={onAddModel}
                  size="small"
                  className="size-7 rounded-full"
                >
                  <Plus size={16} />
                </IconButton>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Switch prompt preset"
                      title="Switch Prompt Preset"
                      className="size-7 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <ScrollText size={16} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={6}
                    className="w-80 gap-1 p-1"
                  >
                    {PROMPT_PRESETS.map((preset) => {
                      const selected = selectedPromptPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className="flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => actions.setPromptPreset(preset.id as PromptPresetId)}
                        >
                          <Box className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-foreground">
                            {selected ? <Check size={14} /> : null}
                          </Box>
                          <Box className="min-w-0">
                            <Typography variant="body2" weight="medium">
                              {preset.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              className="line-clamp-2"
                            >
                              {preset.content}
                            </Typography>
                          </Box>
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </Box>
              <button
                type="button"
                disabled={!selectedModels[0]}
                className="mt-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
                onClick={() =>
                  selectedModels[0] &&
                  onSetDefault(
                    selectedModelChoices[0] ?? {
                      provider: selectedProviders[0] ?? "OllamaLocal",
                      model: selectedModels[0],
                    },
                  )
                }
              >
                Set as default
              </button>
            </>
          )}
        </Box>
      </Box>

      <Box className="flex shrink-0 items-center gap-2">
        {memoryCount > 0 && (
          <Tooltip title={`${memoryCount} ${memoryCount === 1 ? "memory" : "memories"} in this conversation`}>
            <IconButton
              aria-label="View conversation memories"
              size="small"
              onClick={() => setMemoryPanelOpen(true)}
              className="gap-1"
            >
              <Brain size={15} />
              <Typography variant="caption">{memoryCount}</Typography>
            </IconButton>
          </Tooltip>
        )}
        {ollama.state !== "online" && (
          <Tooltip title={ollama.state === "reconnecting" ? "Reconnecting to providers..." : "Providers offline"}>
            <Box className="inline-flex items-center gap-1.5 text-muted-foreground">
              {ollama.state === "reconnecting" ? (
                <CircularProgress size={12} color="inherit" />
              ) : (
                <Box as="span" className="flex size-4 items-center justify-center">
                  <AlertCircle size={14} />
                </Box>
              )}
              <Typography variant="caption">
                {ollama.state === "reconnecting" ? "Reconnecting" : "Offline"}
              </Typography>
            </Box>
          </Tooltip>
        )}
        <Tooltip
          title={
            isTemporary ? "Disable Temporary Chat" : "Enable Temporary Chat"
          }
        >
          <IconButton
            aria-label={isTemporary ? "Disable temporary chat" : "Enable temporary chat"}
            onClick={onToggleTemporaryChat}
            size="small"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-4.5"
            >
              {isTemporary ? (
                <path
                  d="M8 12L11 15L16 10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                ></path>
              ) : null}
              <path
                d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2.5 21.5L7 20.6622C8.47087 21.513 10.1786 22 12 22Z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2.5 3.5"
              ></path>
            </svg>
          </IconButton>
        </Tooltip>
        {!viewportDrawerOpen ? (
          <Tooltip title="Open viewport drawer">
            <IconButton
              aria-label="Open viewport drawer"
              onClick={openEmptyViewport}
              size="small"
            >
              <PanelRightIcon size={16} />
            </IconButton>
          </Tooltip>
        ) : null}

      </Box>

      {activeConversationId && (
        <MemoryPanel
          open={memoryPanelOpen}
          onClose={() => {
            setMemoryPanelOpen(false);
            refreshMemoryCount();
          }}
          conversationId={activeConversationId}
          onChanged={refreshMemoryCount}
        />
      )}
    </Box>
  );
});
