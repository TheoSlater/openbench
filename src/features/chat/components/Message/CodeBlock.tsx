import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@/components/ui/Box";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";
import { Typography } from "@/components/ui/Typography";

import { Copy, Check } from "lucide-react";
import { highlight } from "sugar-high";
import * as presets from "sugar-high/presets";
import { useNotify } from "@/hooks/useNotify";

const LANGUAGE_PRESETS = {
  c: presets.c,
  css: presets.css,
  diff: presets.diff,
  go: presets.go,
  java: presets.java,
  py: presets.python,
  python: presets.python,
  rs: presets.rust,
  rust: presets.rust,
} as const;

const JAVASCRIPT_LANGUAGES = new Set([
  "js",
  "javascript",
  "jsx",
  "ts",
  "tsx",
  "typescript",
]);

function getHighlightedHtml(value: string, language?: string | null): string | null {
  const normalizedLanguage = language?.toLowerCase();
  if (!normalizedLanguage) return null;
  if (JAVASCRIPT_LANGUAGES.has(normalizedLanguage)) return highlight(value);

  const preset = LANGUAGE_PRESETS[normalizedLanguage as keyof typeof LANGUAGE_PRESETS];
  return preset ? highlight(value, preset) : null;
};

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useNotify();
  // Highlight partial code too — sugar-high tokenizes incomplete input
  // fine, and deferring it made finished blocks visibly recolour.
  const highlightedHtml = useMemo(
    () => getHighlightedHtml(code, language),
    [code, language],
  );
  const label = language?.trim() || "text";

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        // The icon swap below is the confirmation; a toast on top of it
        // was double feedback for a one-click action.
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => {
          copiedTimerRef.current = null;
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        notify.error("Failed to copy");
      });
  };

  return (
    <Box
      className="my-3 overflow-hidden rounded-2xl border border-border/50 bg-muted/40"
    >
      <Box
        className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2"
      >
        <Typography
          variant="caption"
          color="text.secondary"
        >
          {label}
        </Typography>
        <Tooltip title={copied ? "Copied!" : "Copy code"}>
          <IconButton
            aria-label={copied ? "Code copied" : "Copy code"}
            size="small"
            onClick={handleCopy}
            className="copy-button size-7 rounded-full"
          >
            <Box
              className="flex size-4 items-center justify-center"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Box>
          </IconButton>
        </Tooltip>
      </Box>

      {highlightedHtml ? (
        <Box
          as="pre"
          className="overflow-x-auto p-3 text-sm leading-6"
        >
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </Box>
      ) : (
        <Box
          as="pre"
          className="overflow-x-auto p-3 text-sm leading-6"
        >
          <code>{code}</code>
        </Box>
      )}
    </Box>
  );
});
