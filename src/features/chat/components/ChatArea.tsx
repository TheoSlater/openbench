import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import type { ChatMessage } from "@/types/chat";
import { Message } from "./Message";
import { Box } from "@/components/ui/Box";
import { CircularProgress } from "@/components/ui/spinner";
import { Typography } from "@/components/ui/Typography";
import { useChatStore } from "@/store/chatStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StickToBottom, useStickToBottom } from "use-stick-to-bottom";
import { ScrollButton } from "@/components/ui/scroll-button";
import { PRETEXT_FONTS, PRETEXT_LINE_HEIGHTS, measureTextHeight } from "@/lib/utils/pretext";
import { getMotionPolicy } from "@/lib/performance/policy";

interface ChatAreaProps {
  messages: ChatMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onRegenerate?: (messageIndex: number) => void;
  isTemporary?: boolean;
  activity?: ReactNode;
}

interface MessageTurn {
  userMessage: ChatMessage | null;
  assistantMessages: ChatMessage[];
  startIndex: number;
}

const ESTIMATED_TURN_HEIGHT = 220;

function estimateMessageHeight(message: ChatMessage, width: number) {
  const content = `${message.content || ""}\n${message.thinking || ""}`;
  if (!content.trim()) return 72;
  const measured = measureTextHeight(
    content,
    message.role === "user" ? PRETEXT_FONTS.userMessage : PRETEXT_FONTS.message,
    width,
    message.role === "user"
      ? PRETEXT_LINE_HEIGHTS.userMessage
      : PRETEXT_LINE_HEIGHTS.message,
    { fallbackLineHeightPx: 24 },
  );
  const chrome = message.role === "user" ? 48 : 72;
  return Math.min(5000, Math.max(96, Math.ceil(measured + chrome)));
}

function estimateTurnHeight(turn: MessageTurn, width: number) {
  const userHeight = turn.userMessage
    ? estimateMessageHeight(turn.userMessage, width)
    : 0;
  const assistantHeight = Math.max(
    0,
    ...turn.assistantMessages.map((message) => estimateMessageHeight(message, width)),
  );
  return Math.max(ESTIMATED_TURN_HEIGHT, userHeight + assistantHeight + 32);
}

const TurnItem = memo(function TurnItem({
  turn,
  turnIndex,
  isNewest,
  onRegenerate,
  streamingForTurn,
}: {
  turn: MessageTurn;
  turnIndex: number;
  isNewest: boolean;
  onRegenerate?: (index: number) => void;
  streamingForTurn?: ChatMessage[];
}) {
  const allAssistantMessages = useMemo(() => {
    if (!streamingForTurn?.length) return turn.assistantMessages;
    const existingIds = new Set(turn.assistantMessages.map((m) => m.id));
    const deduped = streamingForTurn.filter(
      (sm) => !existingIds.has(sm.id),
    );
    return [...turn.assistantMessages, ...deduped];
  }, [turn.assistantMessages, streamingForTurn]);

  return (
    <Box
      key={
        turn.userMessage?.id ||
        turn.assistantMessages[0]?.id ||
        `turn-${turnIndex}`
      }
      className="flex flex-col gap-5 py-2"
    >
      {turn.userMessage && (
        <Box className="flex justify-end animate-in fade-in-0 slide-in-from-bottom-1 duration-[var(--dur-base)] ease-[var(--ease-premium)]">
          <Message
            role={turn.userMessage.role}
            id={turn.userMessage.id}
            conversationId={turn.userMessage.conversationId}
            content={turn.userMessage.content}
            attachments={turn.userMessage.attachments}
            model={turn.userMessage.model}
            messageIndex={turn.startIndex}
            onRegenerate={onRegenerate}
          />
        </Box>
      )}

      {allAssistantMessages.length > 0 && (
        <Box className="flex flex-col gap-3">
          {allAssistantMessages.map((msg, idx) => (
            <Box
              key={msg.id || `msg-${turnIndex}-${idx}`}
              className="flex justify-start animate-in fade-in-0 slide-in-from-bottom-1 duration-[var(--dur-base)] ease-[var(--ease-premium)]"
            >
              <Message
                role={msg.role}
                id={msg.id}
                conversationId={msg.conversationId}
                content={msg.content}
                attachments={msg.attachments}
                model={msg.model}
                thinking={msg.thinking}
                thinkingDuration={msg.thinkingDuration}
                thinkingTimings={msg.thinkingTimings}
                isThinking={msg.isThinking}
                isStreaming={msg.isStreaming}
                status={msg.status}
                errorMessage={msg.errorMessage}
                messageIndex={turn.startIndex + 1 + idx}
                onRegenerate={onRegenerate}
                webSearch={msg.webSearch}
                memoryUpdates={msg.memoryUpdates}
                runtimeParts={msg.runtimeParts}
                isLastMessage={isNewest && idx === allAssistantMessages.length - 1}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
});

export const ChatArea = memo(function ChatArea({
  messages,
  bottomRef,
  onRegenerate,
  isTemporary,
  activity,
}: ChatAreaProps) {
  const hasMoreMessages = useChatStore((state) => state.hasMoreMessages);
  const loadMoreMessages = useChatStore(
    (state) => state.actions.loadMoreMessages,
  );
  const streamingMessages = useChatStore((state) => state.streamingMessages);
  const activeConvId = useChatStore((state) => state.activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useStickToBottom({ initial: "smooth", resize: "smooth" });
  const [viewportWidth, setViewportWidth] = useState(768);
  const scrollAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
    pending: boolean;
  } | null>(null);
  const onRegenCb = useCallback(
    (i: number) => onRegenerate?.(i),
    [onRegenerate],
  );

  const [announcement, setAnnouncement] = useState("");
  const streamingMessagesList = useMemo(
    () => Object.values(streamingMessages).filter((m) => m.conversationId === activeConvId),
    [activeConvId, streamingMessages],
  );

  // Announce the reply once, when it lands — not while it streams.
  const isResponding = streamingMessagesList.length > 0;
  const wasRespondingRef = useRef(false);
  useEffect(() => {
    if (wasRespondingRef.current && !isResponding) {
      const last = messages[messages.length - 1];
      const words = last?.content?.trim().split(/\s+/).filter(Boolean).length ?? 0;
      setAnnouncement(words > 0 ? `Response complete, ${words} words.` : "Response complete.");
    }
    if (isResponding) setAnnouncement("");
    wasRespondingRef.current = isResponding;
  }, [isResponding, messages]);

  // Sending is an explicit action, so it always returns you to the bottom even
  // if you had scrolled away — unlike a streaming reply, which must not yank
  // you down while you are reading back. Keyed on the newest *user* message so
  // assistant tokens never trigger it. scrollToBottom re-arms the stick lock
  // itself, and ignoreEscapes keeps the trip from being cancelled midway.
  const lastUserMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") return messages[index].id;
    }
    return null;
  }, [messages]);
  const seenUserMessageRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (seenUserMessageRef.current === undefined) {
      // First commit for this conversation: `initial` already scrolls.
      seenUserMessageRef.current = lastUserMessageId;
      return;
    }
    if (!lastUserMessageId || lastUserMessageId === seenUserMessageRef.current) {
      return;
    }
    seenUserMessageRef.current = lastUserMessageId;
    void stickToBottom.scrollToBottom({
      animation: "smooth",
      ignoreEscapes: true,
    });
  }, [lastUserMessageId, stickToBottom]);

  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      stickToBottom.scrollRef(node);
    },
    [stickToBottom.scrollRef],
  );

  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      stickToBottom.contentRef(node);
    },
    [stickToBottom.contentRef],
  );

  // Scroll anchoring for load-more: restore position after prepending
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor?.pending) return;
    const el = scrollRef.current;
    if (!el) return;
    const heightDiff = el.scrollHeight - anchor.scrollHeight;
    if (heightDiff > 0) {
      el.scrollTop = anchor.scrollTop + heightDiff;
    }
    scrollAnchorRef.current = null;
  }, [messages]);

  const handleLoadMore = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollAnchorRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      pending: true,
    };
    void loadMoreMessages();
  }, [loadMoreMessages]);

  useEffect(() => {
    if (!hasMoreMessages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadMore();
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMoreMessages, handleLoadMore]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    // Committing the width on every ResizeObserver callback made the sidebar
    // collapse animation drag the whole chat panel with it: each frame
    // re-rendered this component, recomputed estimateTurnHeight across every
    // turn in the conversation, and invalidated the virtualizer's sizes.
    // The width only feeds *estimated* heights for unmeasured rows, so it is
    // enough to commit once the resize has settled.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const commit = () => {
      setViewportWidth((current) =>
        Math.abs(current - element.clientWidth) < 1 ? current : element.clientWidth,
      );
    };
    const onResize = () => {
      clearTimeout(settle);
      settle = setTimeout(commit, getMotionPolicy().transitionDurationMs);
    };

    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    commit();

    return () => {
      clearTimeout(settle);
      observer.disconnect();
    };
  }, []);

  const turns = useMemo(() => {
    const result: MessageTurn[] = [];
    let currentTurn: MessageTurn | null = null;

    messages.forEach((msg, index) => {
      if (msg.role === "user") {
        if (currentTurn) {
          result.push(currentTurn);
        }
        currentTurn = {
          userMessage: msg,
          assistantMessages: [],
          startIndex: index,
        };
      } else if (msg.role === "assistant") {
        if (currentTurn) {
          currentTurn.assistantMessages.push(msg);
        } else {
          result.push({
            userMessage: null,
            assistantMessages: [msg],
            startIndex: index,
          });
        }
      }
    });

    if (currentTurn) {
      result.push(currentTurn);
    }

    return result;
  }, [messages]);

  const motionPolicy = useMemo(() => getMotionPolicy(), []);
  const estimateWidth = Math.min(768, Math.max(320, viewportWidth - 48));
  const estimatedTurnHeights = useMemo(
    () => turns.map((turn) => estimateTurnHeight(turn, estimateWidth)),
    [estimateWidth, turns],
  );
  const rowVirtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimatedTurnHeights[index] ?? ESTIMATED_TURN_HEIGHT,
    overscan: motionPolicy.virtualOverscan,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Turns are appended in place when a new message lands, but each row's
  // translateY is computed from sizes that may be an estimate or stale for one
  // frame. Re-measuring synchronously before paint keeps a freshly appended
  // turn from briefly overlapping the previous one (most visible with tall
  // agent replies, whose plan/tool parts the estimator cannot predict).
  useLayoutEffect(() => {
    if (turns.length) rowVirtualizer.measure();
  }, [turns, rowVirtualizer]);

  return (
    // StickToBottom only supplies context here — it reuses the instance above
    // rather than binding its own refs, so the scroll element stays ours.
    <StickToBottom
      instance={stickToBottom}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      <Box
        ref={setScrollRef}
        role="log"
        // No aria-live here. With `aria-relevant="additions text"` a screen
        // reader read out every streamed token, and because the list is
        // virtualized it re-announced old turns as rows recycled on scroll.
        // Completion is announced once, from the region below.
        aria-busy={isResponding}
        // Block layout, deliberately not `flex`. As a flex row with a definite
        // height, `align-items: stretch` pinned the content child's height to
        // this container's height, so it never grew. use-stick-to-bottom drives
        // auto-scroll from a ResizeObserver on that child, which therefore
        // never fired: sending a message or streaming a reply scrolled nothing.
        // `mx-auto max-w-3xl` still centres the content in normal flow.
        // scrollbar-gutter keeps the space reserved, so the centred column
        // does not jump sideways the moment a conversation becomes long
        // enough to scroll.
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6 [scrollbar-gutter:stable]"
      >
        <Box className="sr-only" role="status" aria-live="polite">
          {announcement}
        </Box>
      <Box
        ref={setContentRef}
        className="relative mx-auto w-full max-w-3xl"
      >
        <Box
          ref={loadMoreRef}
          className="flex min-h-6 items-center justify-center pb-2 text-muted-foreground"
        >
          {isTemporary && (
            <Box
              className="rounded-full border border-dashed border-border/60 px-3 py-1"
            >
              <Typography
                variant="caption"
                color="text.secondary"
              >
                Temporary Chat Enabled
              </Typography>
            </Box>
          )}
          {hasMoreMessages && <CircularProgress size={20} color="inherit" />}
        </Box>

        <Box
          className="relative w-full"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
        {virtualRows.map((virtualRow) => {
          const turnIndex = virtualRow.index;
          const turn = turns[turnIndex];
          if (!turn) return null;
          const isNewest = turnIndex === turns.length - 1;
          return (
            <Box
              key={
                turn.userMessage?.id ||
                turn.assistantMessages[0]?.id ||
                `turn-${turnIndex}`
              }
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-4"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <TurnItem
                turn={turn}
                turnIndex={turnIndex}
                isNewest={isNewest}
                onRegenerate={onRegenCb}
                streamingForTurn={
                  isNewest && streamingMessagesList.length > 0
                    ? streamingMessagesList
                    : undefined
                }
              />
            </Box>
          );
        })}
        </Box>

        {activity}
        <Box ref={bottomRef} className="h-px" />
      </Box>

      </Box>

      {/* Deliberately a sibling of the scroll container, not a child: an
          absolutely positioned descendant of a scrolling element scrolls away
          with the content, which is why the old button drifted out of view.
          Sitting at the bottom of the chat area puts it directly above the
          composer. */}
      <Box className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
        <ScrollButton
          loading={isResponding}
          className="pointer-events-auto bg-background/90 shadow-md backdrop-blur-sm"
        />
      </Box>
    </StickToBottom>
  );
});
