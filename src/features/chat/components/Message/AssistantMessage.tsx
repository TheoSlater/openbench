import { useState } from "react";
import {
  Copy,
  MoreHorizontal,
  RotateCcw,
  Check,
  AlertCircle,
  StopCircle,
  Volume2,
  Square,
} from "lucide-react";
import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { CircularProgress } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotify } from "@/hooks/useNotify";

import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { MemoryDisclosure } from "./MemoryDisclosure";
import { WebSearchDisclosure } from "./WebSearchDisclosure";
import { Source, SourceTrigger, SourceContent } from "@/components/ui/source";

import type { MessageProps } from "./types";
import {
  useCopyMessage,
  useMessageStreaming,
  useMessageMarkdown,
  useMessageTts,
} from "./hooks";
import { MemoryMenuItems } from "./MemoryMenuItems";
import { MarkdownProse } from "./MarkdownProse";
import { useSettingsStore } from "@/store/settingsStore";

export function AssistantMessage(props: MessageProps) {
  const {
    content,
    id,
    conversationId,
    messageIndex,
    model,
    thinking,
    thinkingDuration,
    isThinking,
    isStreaming,
    status,
    errorMessage,
    onRegenerate,
    webSearch,
    isLastMessage,
    memoryUpdates,
  } = props;

  const { copied, handleCopy } = useCopyMessage(content);
  const [webSearchExpanded, setWebSearchExpanded] = useState(false);
  const notify = useNotify();
  const memoryUiEnabled = useSettingsStore((state) => state.general.memoryBeta);

  const streamingDisplayContent = useMessageStreaming(content, isStreaming);
  const { processedContent, processedThinking } = useMessageMarkdown(
    content,
    thinking,
    isStreaming,
  );
  const { isSpeaking, isGenerating, handleSpeak } = useMessageTts(
    messageIndex,
    content,
  );

  const canRegenerate =
    typeof messageIndex === "number" && typeof onRegenerate === "function";
  const showEmptyFinalNotice =
    !isStreaming &&
    status !== "error" &&
    status !== "aborted" &&
    !content.trim() &&
    Boolean(thinking?.trim());

  return (
    <Box
      className="group/message mr-auto flex w-full max-w-[min(100%,48rem)] flex-col gap-2"
    >
      <Box className="px-4 py-3 text-card-foreground">
        {model && (
          <Typography
            variant="caption"
            color="text.secondary"
            className="mb-2 block"
          >
            {model}
          </Typography>
        )}

         {status === "error" && (
          <Box
            className="mb-3 flex gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 p-3 text-destructive"
          >
            <AlertCircle size={18} />
            <Box>
              <Typography
                variant="caption"
                weight="medium"
              >
                Generation Error
              </Typography>
              <Typography
                variant="body2"
                className="text-current"
              >
                {errorMessage || "The provider encountered an issue."}
              </Typography>
              {onRegenerate && typeof messageIndex === "number" && (
                <IconButton
                  size="small"
                  onClick={() => onRegenerate(messageIndex)}
                  className="mt-2 rounded-full"
                >
                  <RotateCcw size={14} />
                  <Typography variant="caption">
                    Retry
                  </Typography>
                </IconButton>
              )}
            </Box>
          </Box>
        )}

        {status === "aborted" && (
          <Box
            className="mb-3 flex items-center gap-2 text-muted-foreground"
          >
            <StopCircle size={14} />
            <Typography
              variant="caption"
            >
              Generation stopped by user
            </Typography>
          </Box>
        )}

        <MemoryDisclosure summaries={memoryUpdates} />

        <ThinkingDisclosure
          thinking={thinking}
          isThinking={isThinking ?? false}
          thinkingDuration={thinkingDuration}
          processedThinking={processedThinking}
          status={status}
        />

        {webSearch && (
          <Box>
            <WebSearchDisclosure
              isSearching={webSearch.status === "searching"}
              query={webSearch.query}
              results={webSearch.results}
              isExpanded={webSearchExpanded}
              onToggle={() => setWebSearchExpanded((v) => !v)}
            />
          </Box>
        )}

        {/* ── Markdown Core Message Body ── */}
        {content ? (
          <Box
            id={`message-${messageIndex}`}
            className="min-w-0"
          >
            {isStreaming ? (
              <Typography
                as="p"
                className="whitespace-pre-wrap text-sm leading-6"
              >
                {streamingDisplayContent || content}
              </Typography>
            ) : (
              <MarkdownProse content={processedContent} />
            )}
          </Box>
        ) : showEmptyFinalNotice ? (
          <Box
            id={`message-${messageIndex}`}
            className="text-sm text-muted-foreground"
          >
            The model returned reasoning but no final response.
          </Box>
        ) : null}

        {/* ── Source Badges ── */}
        {!isStreaming && webSearch?.results && webSearch.results.length > 0 && (
          <Box className="mt-3 flex flex-wrap gap-2">
            {webSearch.results.map((result) => (
              <Source key={result.url} href={result.url}>
                <SourceTrigger showFavicon />
                <SourceContent
                  title={result.title}
                  description={result.highlights?.join(" ") || ""}
                />
              </Source>
            ))}
          </Box>
        )}

        {/* ── Contextual Action Toolbar ── */}
        <Box
          className={`${!isLastMessage ? "action-bar " : ""}mt-2 flex items-center gap-1 text-muted-foreground transition-opacity`}
        >
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton
              size="small"
              onClick={handleCopy}
              className="size-7 rounded-full"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </Tooltip>

          {typeof messageIndex === "number" && (
            <Tooltip title={isSpeaking ? "Stop reading" : "Read message"}>
              <IconButton
                size="small"
                onClick={handleSpeak}
                disabled={isStreaming || (isGenerating && !isSpeaking)}
                className="size-7 rounded-full"
              >
                {isGenerating ? (
                  <CircularProgress size={14} color="inherit" />
                ) : isSpeaking ? (
                  <Square size={14} />
                ) : (
                  <Volume2 size={14} />
                )}
              </IconButton>
            </Tooltip>
          )}

          {canRegenerate && (
            <Tooltip title="Regenerate">
              <IconButton
                size="small"
                onClick={() => onRegenerate(messageIndex)}
                className="size-7 rounded-full"
              >
                <RotateCcw size={14} />
              </IconButton>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="small"
                className="size-7 rounded-full"
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {memoryUiEnabled && (
                <MemoryMenuItems messageId={id} conversationId={conversationId} content={content} />
              )}
              <DropdownMenuItem onClick={handleCopy}>
                <Copy size={14} />
                Copy message
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const plain = content
                    .replace(/[#*`~\[\]()>|\\]/g, "")
                    .replace(/\n{3,}/g, "\n\n");
                  navigator.clipboard.writeText(plain).then(() => {
                    notify.success("Copied as plain text");
                  });
                }}
              >
                <Copy size={14} />
                Copy as plain text
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Box>
      </Box>
    </Box>
  );
}
