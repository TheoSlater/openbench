import { useEffect, useMemo, useState } from "react";
import { useTtsStore } from "@/store/ttsStore";
import { useNotify } from "@/hooks/useNotify";
import { stripInvisible } from "./utils";

export function useMessageMarkdown(content: string, thinking?: string, isStreaming?: boolean) {
  const processedContent = useMemo(() => {
    if (!content) return "";
    if (isStreaming) return content;
    const cleaned = stripInvisible(content);
    return cleaned
      .replace(/\\\[/g, "$$$$")
      .replace(/\\\]/g, "$$$$")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");
  }, [content, isStreaming]);

  const processedThinking = useMemo(() => {
    if (!thinking) return "";
    const cleaned = stripInvisible(thinking);
    if (isStreaming) return cleaned;
    return cleaned
      .replace(/\\\[/g, "$$$$")
      .replace(/\\\]/g, "$$$$")
      .replace(/\\\(/g, "$")
      .replace(/\\\)/g, "$");
  }, [thinking, isStreaming]);

  return { processedContent, processedThinking };
}

export function useMessageTts(messageIndex?: number, content?: string) {
  const notify = useNotify();
  const activeMessageId = useTtsStore((s) => s.activeMessageId);
  const isPlaying = useTtsStore((s) => s.isPlaying);
  const isGenerating = useTtsStore((s) => s.isGenerating);
  const ttsActions = useTtsStore((s) => s.actions);

  const isSpeaking =
    typeof messageIndex === "number" &&
    activeMessageId === messageIndex &&
    isPlaying;
  const isActiveTts =
    typeof messageIndex === "number" &&
    activeMessageId === messageIndex &&
    isGenerating;

  const handleSpeak = () => {
    if (typeof messageIndex !== "number" || !content) return;
    if (isSpeaking || isActiveTts) {
      ttsActions.stop();
    } else {
      ttsActions.play(messageIndex, content).catch((err) => {
        notify.error("TTS error", err?.message ?? String(err));
      });
    }
  };

  return { isSpeaking, isGenerating, isActiveTts, handleSpeak };
}

export function useCopyMessage(content: string) {
  const notify = useNotify();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard
      ?.writeText(content)
      .then(() => {
        setCopied(true);
        notify.success("Copied to clipboard");
      })
      .catch(() => {
        notify.error("Failed to copy");
      });
  };

  return { copied, handleCopy };
}
