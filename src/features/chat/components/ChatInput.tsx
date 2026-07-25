import {
  Square,
  Plus,
  ArrowUp,
  Paperclip,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  Mic,
  X,
  MoreHorizontal,
  Globe,
  AudioLines,
} from "lucide-react";
import { useState, memo, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Box } from "@/components/ui/Box";
import { InputBase } from "@/components/ui/input-base";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";

import { Square as StopIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { useFeatures, type FeatureDef } from "@/lib/featureRegistry";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useFileDragDetection } from "@/features/chat/hooks/useFileDragDetection";
import {
  useAutoResizeTextarea,
} from "@/features/chat/hooks/useAutoResizeTextarea";
import { useSlashCommand } from "@/features/chat/hooks/useSlashCommand";
import { Spinner } from "@/components/ui/spinner";
import { useDictation } from "@/hooks/useDictation";
import { DictationModelDialog } from "@/features/dictation/DictationModelDialog";
import { SlashCommandMenu } from "@/features/chat/components/ChatInput/SlashCommandMenu";
import { ChatAttachmentsList } from "@/features/chat/components/ChatInput/ChatAttachmentsList";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "@/store/settingsStore";
import { useChatStore } from "@/store/chatStore";
import type { ConversationMetadata } from "@/types/chat";

interface ChatInputProps {
  onSubmit: (value: string) => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  onFocusChange?: (focused: boolean) => void;
  isTemporary?: boolean;
  conversationId?: string | null;
  onOpenVoiceMode?: () => void;
}

const joinTranscript = (base: string, text: string) =>
  base.trim() ? `${base.trimEnd()} ${text}` : text;

export const ChatInput = memo(function ChatInput({
  onSubmit,
  onStop,
  isStreaming,
  onFocusChange,
  isTemporary,
  conversationId,
  onOpenVoiceMode,
}: ChatInputProps) {
  const [draft, setDraft] = useState("");
  const [pastedPreview, setPastedPreview] = useState<{
    id: string;
    text: string;
    preview: string;
    lines: number;
    chars: number;
  } | null>(null);
  const restoringChatIdRef = useRef<string | null>(null);
  const activeConversation = useChatStore((state) =>
    conversationId ? state.conversations.find((c) => c.id === conversationId) : undefined,
  );
  const updateConversationMetadata = useChatStore(
    (state) => state.actions.updateConversationMetadata,
  );
  const dictationEnabled = useSettingsStore(
    (state) => state.dictation.enabled,
  );
  const voiceModeExperimental = useSettingsStore(
    (state) => state.general.voiceModeExperimental,
  );

  const {
    fileInputRef,
    fileAccept,
    currentAttachments,
    removeCurrentAttachment,
    processFiles,
    openFilePicker,
    handleFileChange,
    handlePaste,
  } = useChatAttachments();
  const { isDraggingFiles } = useFileDragDetection({
    onFilesDropped: processFiles,
  });
  const dropOverlay =
    isDraggingFiles && typeof document !== "undefined"
      ? createPortal(
          <Box
            className="chat-file-drop-overlay"
            aria-hidden="true"
          >
            <Box className="chat-file-drop-overlay__content">
              <Box className="chat-file-drop-overlay__icons">
                <Box className="chat-file-drop-overlay__file chat-file-drop-overlay__file--image">
                  <ImageIcon size={32} strokeWidth={2.5} />
                </Box>
                <Box className="chat-file-drop-overlay__file chat-file-drop-overlay__file--text">
                  <FileText size={34} strokeWidth={2.6} />
                </Box>
                <Box className="chat-file-drop-overlay__file chat-file-drop-overlay__file--clip">
                  <Paperclip size={28} strokeWidth={2.7} />
                </Box>
              </Box>
              <h2 className="chat-file-drop-overlay__title">
                Add anything
              </h2>
              <p className="chat-file-drop-overlay__copy">
                Drop any file here to add it to the conversation
              </p>
            </Box>
          </Box>,
          document.body,
        )
      : null;

  const handleTextPaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const lines = text.split("\n").length;
    const chars = text.length;
    if (chars > 500 || lines > 5) {
      e.preventDefault();
      e.stopPropagation();
      setPastedPreview({
        id: crypto.randomUUID(),
        text,
        preview: text.split("\n").slice(0, 3).join("\n").slice(0, 250),
        lines,
        chars,
      });
    }
  }, []);

  const handlePasteCombined = useCallback(
    (e: React.ClipboardEvent) => {
      handleTextPaste(e);
      if (!e.defaultPrevented) {
        handlePaste(e);
      }
    },
    [handlePaste, handleTextPaste],
  );

  const dismissPastedPreview = useCallback(() => {
    setPastedPreview(null);
  }, []);

  const textareaRef = useAutoResizeTextarea(draft);
  const { showSlashMenu, slashQuery, closeSlashMenu } = useSlashCommand(draft);

  const features = useFeatures();
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  const filteredFeatures = useMemo(() => {
    const query = slashQuery.toLowerCase().trim();

    return query
      ? features.filter((feature) =>
          [feature.name, feature.description, feature.id].some((field) =>
            field?.toLowerCase().includes(query),
          ),
        )
      : features;
  }, [features, slashQuery]);

  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

  const webSearchFeature = features.find((feature) => feature.id === "web_search");
  const moreFeatures = features.filter((feature) => feature.id !== "web_search");
  const activeFeatureIds = useMemo(
    () => features.filter((feature) => feature.active).map((feature) => feature.id).sort(),
    [features],
  );
  const activeFeatureKey = activeFeatureIds.join(",");

  useEffect(() => {
    if (!conversationId || !activeConversation?.metadata) return;
    restoringChatIdRef.current = conversationId;
    const ids = new Set(activeConversation.metadata.activeFeatureIds ?? []);
    const settings = useSettingsStore.getState();

    settings.actions.updateGeneral({
      webSearchEnabled: ids.has("web_search"),
    });
    requestAnimationFrame(() => {
      if (restoringChatIdRef.current === conversationId) restoringChatIdRef.current = null;
    });
  }, [activeConversation?.metadata, conversationId]);

  useEffect(() => {
    if (!conversationId || !activeConversation) return;
    if (restoringChatIdRef.current === conversationId) return;
    const next: ConversationMetadata = {
      ...activeConversation.metadata,
      activeFeatureIds,
    };
    if (JSON.stringify(next) === JSON.stringify(activeConversation.metadata ?? {})) return;
    void updateConversationMetadata(conversationId, next);
  }, [
    activeConversation,
    activeFeatureKey,
    activeFeatureIds,
    conversationId,
    updateConversationMetadata,
  ]);

  const hasContent =
    draft.trim() || currentAttachments.length > 0 || !!pastedPreview;
  const showVoiceModeAction =
    voiceModeExperimental &&
    !isStreaming &&
    draft.length === 0 &&
    currentAttachments.length === 0 &&
    !pastedPreview &&
    Boolean(onOpenVoiceMode);
  // Draft as it was when dictation started; live partials and the final
  // transcript both replace everything after it, so streaming text never
  // stacks on top of itself.
  const dictationBaseRef = useRef("");
  const appendTranscript = useCallback((text: string) => {
    const transcript = text.trim();
    if (!transcript) return;

    setDraft(joinTranscript(dictationBaseRef.current, transcript));
  }, []);
  const {
    recording,
    partialTranscript,
    start,
    stop,
    installOpen,
    models,
    selectedModelId,
    installingModelId,
    downloadProgress,
    closeInstall,
    installModel,
    selectInstalledModel,
    processing,
  } = useDictation(appendTranscript, { partials: true });

  // Stream the live transcript into the composer while recording.
  useEffect(() => {
    if (!recording || !partialTranscript) return;
    setDraft(joinTranscript(dictationBaseRef.current, partialTranscript));
  }, [recording, partialTranscript]);

  const downloadPercent =
    downloadProgress?.totalBytes && downloadProgress.totalBytes > 0
      ? Math.round(
          (downloadProgress.downloadedBytes / downloadProgress.totalBytes) *
            100,
        )
      : null;

  // Feature flag: toggle to disable image uploads in the attachment menu.
  const canUploadImages = true;

  const handleSubmit = useCallback(() => {
    if (!hasContent && !pastedPreview) return;
    const finalText = pastedPreview
      ? draft.trim()
        ? `${draft}\n\n${pastedPreview.text}`
        : pastedPreview.text
      : draft;

    const trimmed = finalText.trim();
    onSubmit(trimmed);
    setDraft("");
    setPastedPreview(null);
  }, [
    hasContent,
    draft,
    pastedPreview,
    onSubmit,
  ]);

  const handleAction = useCallback(() => {
    if (isStreaming) {
      onStop();
      return;
    }

    handleSubmit();
  }, [handleSubmit, isStreaming, onStop]);

  const handleSlashSelect = useCallback(
    (feature: FeatureDef & { active: boolean; warning?: string }) => {
      feature.toggle();
      setDraft((prev) => prev.replace(/(?:^|\s)\/\w*$/, ""));
      closeSlashMenu();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => textareaRef.current?.focus());
      });
    },
    [closeSlashMenu, textareaRef],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashMenu) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashMenuIndex(
            (prev) => (prev + 1) % (filteredFeatures.length || 1),
          );
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashMenuIndex(
            (prev) =>
              (prev - 1 + (filteredFeatures.length || 1)) %
              (filteredFeatures.length || 1),
          );
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();

          if (filteredFeatures[slashMenuIndex]) {
            handleSlashSelect(filteredFeatures[slashMenuIndex]);
          }

          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          closeSlashMenu();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      closeSlashMenu,
      filteredFeatures,
      draft,
      handleSlashSelect,
      handleSubmit,
      showSlashMenu,
      slashMenuIndex,
    ],
  );

  return (
    <Box className="relative w-full">
      <input
        type="file"
        multiple
        ref={fileInputRef}
        accept={fileAccept}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {dropOverlay}

      <Box className="relative w-full">
        {showSlashMenu && (
            <SlashCommandMenu
              features={filteredFeatures}
              onSelect={handleSlashSelect}
              selectedIndex={slashMenuIndex}
              slashQuery={slashQuery}
            />
          )}

        <Box
          className={cn(
            "chat-file-drop-target w-full rounded-3xl border bg-popover px-4 py-3 shadow-sm transition-colors duration-[var(--dur-fast)] ease-[var(--ease-soft)]",
            isTemporary
              ? "border-dashed border-border/60"
              : "border-transparent hover:border-border/60 focus-within:border-border/60",
          )}
          aria-label="Chat message composer. Drop files here to attach them."
          aria-describedby={isDraggingFiles ? "chat-file-drop-status" : undefined}
          data-file-drag-active={isDraggingFiles ? "true" : "false"}
        >
          <Box className="relative flex min-h-16 flex-col">
            <Box
              id="chat-file-drop-status"
              className="sr-only"
              aria-live="polite"
            >
              {isDraggingFiles ? "Drop files to attach them to this message." : ""}
            </Box>
            {currentAttachments.length > 0 && (
                <ChatAttachmentsList
                  attachments={currentAttachments}
                  onRemove={removeCurrentAttachment}
                />
              )}

            <InputBase
              multiline
              inputRef={textareaRef}
              minRows={1}
              placeholder="How can I help you today?"
              value={draft}
              className="min-h-8 resize-none text-sm leading-6 placeholder:text-muted-foreground"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePasteCombined}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
            />

            {pastedPreview && (
                <Box className="animate-fade-in mb-2 flex items-start justify-between gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2">
                  <Box className="min-w-0">
                    <Box className="flex items-baseline gap-2">
                      <Typography
                        variant="caption"
                        className="font-semibold tracking-wide text-muted-foreground"
                      >
                        PASTED
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {pastedPreview.lines} lines · {pastedPreview.chars}{" "}
                        chars
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      className="mt-1 line-clamp-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
                    >
                      {pastedPreview.preview}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={dismissPastedPreview}
                    aria-label="Remove pasted content"
                    className="shrink-0"
                  >
                    <X size={14} />
                  </IconButton>
                </Box>
              )}

            <Box className="mt-5 flex items-center justify-between gap-2 px-0 pb-0">
              <Box className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Add attachment"
                      disabled={isStreaming}
                      className="size-9 rounded-full"
                    >
                      <Plus size={18} />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="start" className="min-w-48">
                    {canUploadImages ? (
                      <DropdownMenuItem
                        className="gap-2 px-3 py-2 whitespace-nowrap"
                        onClick={() => openFilePicker("image/*")}
                      >
                        <ImageIcon />
                        <span>Upload images</span>
                      </DropdownMenuItem>
                    ) : null}

                    <DropdownMenuItem
                      className="gap-2 px-3 py-2 whitespace-nowrap"
                      onClick={() => openFilePicker("*")}
                    >
                      <Paperclip />
                      <span>Upload files</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {webSearchFeature && (
                  <Button
                    variant="outline"
                    disabled={isStreaming}
                    onClick={() => webSearchFeature.toggle()}
                    title={webSearchFeature.warning ?? "Search"}
                    className={cn(
                      "rounded-full",
                      webSearchFeature.active && "bg-info-soft text-info hover:bg-info-soft hover:text-info",
                    )}
                  >
                    <Globe size={18} />
                    Search
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="More actions"
                      disabled={isStreaming}
                      className="size-9 rounded-full"
                    >
                      <MoreHorizontal size={18} />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="start" className="min-w-48">
                    {moreFeatures.map((feature) => {
                      const Icon = feature.icon;

                      return (
                        <DropdownMenuItem
                          key={feature.id}
                          className={cn(
                            "gap-2 px-3 py-2 whitespace-nowrap",
                            feature.active && "bg-info-soft text-info hover:bg-info-soft hover:text-info",
                          )}
                          onClick={() => feature.toggle()}
                        >
                          <Icon />
                          <span>{feature.name}</span>
                          {feature.warning && (
                            <Tooltip title={feature.warning} arrow>
                              <AlertTriangle
                                className="text-warning"
                              />
                            </Tooltip>
                          )}

                          {feature.active && (
                            <Box
                              className="ml-auto size-2 rounded-full bg-info"
                            />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </Box>

              <Box className="flex items-center gap-2">
                {dictationEnabled && (
                  <Tooltip title="Voice input">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={
                        recording
                          ? stop
                          : () => {
                              dictationBaseRef.current = draft;
                              void start();
                            }
                      }
                      disabled={isStreaming}
                      aria-label={recording ? "Stop dictation" : "Start dictation"}
                      className="size-9 rounded-full"
                    >
                      {processing ? (
                        <Spinner className="size-4 text-muted-foreground" />
                      ) : recording ? (
                        <StopIcon />
                      ) : (
                        <Mic size={18} />
                      )}
                    </Button>
                  </Tooltip>
                )}
                <Button
                  size="icon"
                  onClick={showVoiceModeAction ? onOpenVoiceMode : handleAction}
                  disabled={
                    showVoiceModeAction
                      ? false
                      : isStreaming
                        ? false
                        : !hasContent
                  }
                  aria-label={
                    showVoiceModeAction
                      ? "Open voice mode"
                      : isStreaming
                        ? "Stop generation"
                        : "Send message"
                  }
                  className="size-9 rounded-full"
                >
                  {showVoiceModeAction ? (
                    <AudioLines size={18} />
                  ) : isStreaming ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2.5} />
                  )}
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>

      </Box>

      <DictationModelDialog
        open={installOpen}
        models={models}
        selectedModelId={selectedModelId}
        installingModelId={installingModelId}
        downloadPercent={downloadPercent}
        onClose={closeInstall}
        onInstall={installModel}
        onSelect={selectInstalledModel}
      />
    </Box>
  );
});
