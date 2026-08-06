import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ui/reasoning";
import { TextShimmer } from "@/components/ui/text-shimmer";

export function formatThinkingDuration(seconds: number): string {
  if (seconds < 1) return "Thought for less than a second";
  const floored = Math.floor(seconds);
  if (seconds < 60)
    return `Thought for ${floored} second${floored === 1 ? "" : "s"}`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `Thought for ${mins} minute${mins === 1 ? "" : "s"} ${secs} second${secs === 1 ? "" : "s"}`;
}

/** Ticks while `active`, then freezes to `frozen` once inactive. */
export function useLiveSeconds(frozen: number | undefined, active: boolean) {
  const [seconds, setSeconds] = useState(frozen ?? 0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (frozen !== undefined && !active) {
      setSeconds(frozen);
    }
  }, [frozen, active]);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      return;
    }
    if (startRef.current === null) {
      startRef.current = Date.now() - seconds * 1000;
    }
    const interval = setInterval(() => {
      if (startRef.current !== null) {
        setSeconds((Date.now() - startRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  return seconds;
}

interface ThinkingDisclosureProps {
  thinking?: string;
  isThinking: boolean;
  thinkingDuration?: number;
  processedThinking: string;
  status?: string;
}

export const ThinkingDisclosure = React.memo(
  ({
    thinking,
    isThinking,
    thinkingDuration,
    processedThinking,
    status,
  }: ThinkingDisclosureProps) => {
    const hasThinking = Boolean(processedThinking.trim() || thinking?.trim());
    const [expanded, setExpanded] = useState(isThinking || hasThinking);
    const seconds = useLiveSeconds(thinkingDuration, isThinking);

    useEffect(() => {
      if (isThinking) {
        if (hasThinking) setExpanded(true);
      } else if (["complete", "aborted", "error"].includes(status ?? "")) {
        setExpanded(false);
      }
    }, [hasThinking, isThinking, status]);

    const displayIndicator = useMemo(() => {
      if (isThinking) return "Thinking…";
      return formatThinkingDuration(seconds);
    }, [isThinking, seconds]);

    if (!hasThinking && !isThinking) return null;

    return (
      <Reasoning
        open={expanded}
        onOpenChange={setExpanded}
        isStreaming={isThinking}
        className="my-2"
      >
        <ReasoningTrigger>
          {isThinking ? (
            <TextShimmer duration={2} spread={15}>
              {displayIndicator}
            </TextShimmer>
          ) : (
            displayIndicator
          )}
        </ReasoningTrigger>
        {hasThinking && (
          <ReasoningContent markdown>
            {processedThinking}
          </ReasoningContent>
        )}
      </Reasoning>
    );
  },
);

ThinkingDisclosure.displayName = "ThinkingDisclosure";
