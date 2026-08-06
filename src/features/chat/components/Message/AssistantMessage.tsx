import { memo, useEffect, useState, type ReactNode } from "react";
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
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ui/reasoning";

import type { MessageProps } from "./types";
import {
  useCopyMessage,
  useMessageMarkdown,
  useMessageTts,
} from "./hooks";
import { MemoryMenuItems } from "./MemoryMenuItems";
import { MarkdownProse } from "./MarkdownProse";
import { useSettingsStore } from "@/store/settingsStore";
import { AgentParts } from "./AgentParts";

type ResponsePart = NonNullable<MessageProps["runtimeParts"]>[number];

const InlineReasoning = memo(function InlineReasoning({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { processedThinking } = useMessageMarkdown("", text, isStreaming);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setExpanded(Boolean(isStreaming));
  }, [isStreaming]);

  if (!processedThinking.trim()) return null;

  return (
    <Reasoning open={expanded} onOpenChange={setExpanded}>
      <ReasoningTrigger>Reasoning</ReasoningTrigger>
      <ReasoningContent markdown>{processedThinking}</ReasoningContent>
    </Reasoning>
  );
});

const OrderedResponse = memo(function OrderedResponse({
  parts,
  status,
  isStreaming,
}: {
  parts: ResponsePart[];
  status?: string;
  isStreaming?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let activity: ResponsePart[] = [];
  let activityIndex = 0;

  const flushActivity = () => {
    if (!activity.length) return;
    nodes.push(
      <AgentParts
        key={`activity-${activityIndex++}`}
        parts={activity}
        status={status}
        compact
      />,
    );
    activity = [];
  };

  parts.forEach((part, index) => {
    if (part.type === "text") {
      flushActivity();
      if (part.text) {
        nodes.push(
          <Box key={`text-${index}`} className="min-w-0">
            <MarkdownProse content={part.text} streaming={isStreaming} />
          </Box>,
        );
      }
      return;
    }
    if (part.type === "reasoning") {
      flushActivity();
      nodes.push(
        <InlineReasoning
          key={`reasoning-${index}`}
          text={part.text}
          isStreaming={isStreaming}
        />,
      );
      return;
    }
    activity.push(part);
  });
  flushActivity();

  return <div className="flex flex-col gap-3">{nodes}</div>;
});

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
    runtimeParts,
  } = props;

  const { copied, handleCopy } = useCopyMessage(content);
  const [webSearchExpanded, setWebSearchExpanded] = useState(false);
  const notify = useNotify();
  const memoryUiEnabled = useSettingsStore((state) => state.general.memoryBeta);

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
  const hasOrderedResponse = runtimeParts?.some(
    (part) => part.type === "text" || part.type === "reasoning",
  ) ?? false;

  return (
    <Box
      className="group/message mr-auto flex w-full max-w-[min(100%,48rem)] flex-col gap-2"
    >
      {/* select-text: the app sets `user-select: none` on <body> for native
          chrome feel, which otherwise makes model output impossible to
          partially select and copy. */}
      <Box className="px-4 py-3 text-card-foreground select-text">
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

        {!hasOrderedResponse && (
          <ThinkingDisclosure
            thinking={thinking}
            isThinking={isThinking ?? false}
            thinkingDuration={thinkingDuration}
            processedThinking={processedThinking}
            status={status}
          />
        )}

        {hasOrderedResponse ? (
          <OrderedResponse
            parts={runtimeParts ?? []}
            status={status}
            isStreaming={isStreaming}
          />
        ) : (
          <>
            {/* ── Markdown Core Message Body ── */}
            {content ? (
              <Box
                id={`message-${messageIndex}`}
                className="min-w-0"
              >
                {/* Streaming renders through the same markdown path as the final
                    message. parseProgressive escapes half-written syntax, so the
                    answer never re-flows when the stream ends. */}
                <MarkdownProse content={processedContent} streaming={isStreaming} />
              </Box>
            ) : showEmptyFinalNotice ? (
              <Box
                id={`message-${messageIndex}`}
                className="text-sm text-muted-foreground"
              >
                The model returned reasoning but no final response.
              </Box>
            ) : null}

            <AgentParts parts={runtimeParts} status={status} />
          </>
        )}

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
