import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
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
import {
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
import {
  MemoryPanel,
  setMemoryPanelOpen,
  useMemoryPanelOpen,
} from "@/features/memory/MemoryPanel";
import { useConversationMemoryCount } from "@/features/memory/useConversationMemoryCount";
import { showViewportDrawer, useViewportStore } from "@/features/viewport/viewportStore";
import { useRuntimeStore } from "@/features/runtime/runtime-store";
import { runtimeLabel } from "@/features/runtime/runtime-options";
import { isDefaultRuntime, writeDefaultRuntime } from "@/lib/runtime/legacy-default-model";
import { useNotify } from "@/hooks/useNotify";


interface HeaderProps {
  onOpenConnections: () => void;
  isTemporary?: boolean;
  onToggleTemporaryChat: () => void;
}

export const Header = memo(function Header({
  onOpenConnections,
  isTemporary,
  onToggleTemporaryChat,
}: HeaderProps) {
  const { selectedPromptPreset, betaFeatures, actions } = useSettingsStore(
    useShallow((state) => ({
      selectedPromptPreset: state.selectedPromptPreset,
      betaFeatures: state.general.betaFeatures,
      actions: state.actions,
    })),
  );
  const ollama = useOllama();
  const notify = useNotify();
  const { selectedRuntime, selectedLabel, accessMode, setAccessMode } = useRuntimeStore(useShallow((state) => ({
    selectedRuntime: state.selected,
    selectedLabel: state.label,
    accessMode: state.accessMode,
    setAccessMode: state.actions.setAccessMode,
  })));
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const viewportDrawerOpen = useViewportStore((state) => state.drawerOpen);
  const memoryPanelOpen = useMemoryPanelOpen();
  const { count: memoryCount, refresh: refreshMemoryCount } = useConversationMemoryCount(
    activeConversationId ?? undefined,
  );

  return (
    <Box
      as="header"
      className="relative z-20 flex h-16 shrink-0 items-start gap-3 px-5 pt-3"
    >
      <Box className="min-w-0 flex-1 overflow-hidden">
        <Box className="flex flex-col items-start">
          <>
              <Box
                className="flex min-w-0 items-center gap-2"
              >
                <ModelSelector
                  onManageConnections={onOpenConnections}
                />
                {selectedRuntime?.kind === "coding-agent" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    title="Coding-agent workspace access"
                    onClick={() => setAccessMode(
                      accessMode === "read-only" ? "workspace-write" : "read-only",
                    )}
                  >
                    {accessMode === "read-only" ? "Read only" : "Can edit"}
                  </Button>
                ) : null}
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
                disabled={!selectedRuntime}
                className="mt-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
                onClick={() => {
                  if (!selectedRuntime) return;
                  writeDefaultRuntime(selectedRuntime);
                  notify.success(
                    `${selectedLabel || runtimeLabel(selectedRuntime)} set as default`,
                  );
                }}
              >
                {selectedRuntime && isDefaultRuntime(selectedRuntime) ? "Default" : "Set as default"}
              </button>
            </>
        </Box>
      </Box>

      <Box className="flex shrink-0 items-center gap-2">
        {memoryCount > 0 && (
          <Tooltip placement="bottom" title={`${memoryCount} ${memoryCount === 1 ? "memory" : "memories"} in this conversation`}>
            <IconButton
              aria-label="View conversation memories"
              size="small"
              onClick={() => setMemoryPanelOpen(true)}
              className="gap-1"
            >
              <Brain size={16} />
              <Typography variant="caption">{memoryCount}</Typography>
            </IconButton>
          </Tooltip>
        )}
        {ollama.state !== "online" && (
          <Tooltip placement="bottom" title={ollama.state === "reconnecting" ? "Reconnecting to providers..." : "Providers offline"}>
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
          placement="bottom"
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
        {!viewportDrawerOpen && betaFeatures ? (
          <Tooltip placement="bottom" title="Open terminal">
            <IconButton
              aria-label="Open terminal"
              onClick={showViewportDrawer}
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
