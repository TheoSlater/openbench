import { prepare, layout } from "@chenglou/pretext";
import { devLog } from "@/features/debug-overlay/devLog";

/**
 * Pretext configurations for efficient text measurement.
 */

const FONT_FAMILY = '"Geist Variable", "Inter", "system-ui", "sans-serif"';

export const PRETEXT_FONTS = {
  message: `400 15px/1.6 ${FONT_FAMILY}`,
  userMessage: `400 15.5px/1.6 ${FONT_FAMILY}`,
  composer: `400 17px/1.5 ${FONT_FAMILY}`,
  sidebarItem: `400 13.5px/1.5 ${FONT_FAMILY}`,
};

export const PRETEXT_LINE_HEIGHTS = {
  message: 1.6,
  userMessage: 1.6,
  composer: 1.5,
  sidebarItem: 1.5,
};

const cache = new Map<string, number>();
const MAX_CACHE = 500;
let didWarnMeasurementFailure = false;

interface MeasureOptions {
  fallbackLineHeightPx?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function fallbackTextHeight(text: string, width: number, lineHeightPx: number) {
  const hardLines = Math.max(1, text.split("\n").length);
  if (width <= 0) return hardLines * lineHeightPx;
  const averageCharWidth = 7.5;
  const charsPerLine = Math.max(1, Math.floor(width / averageCharWidth));
  const wrappedLines = text
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)),
      0,
    );
  return Math.max(hardLines, wrappedLines) * lineHeightPx;
}

export const measureTextHeight = (
  text: string,
  font: string,
  width: number,
  lineHeight: number,
  options: MeasureOptions = {},
) => {
  const fallbackLineHeightPx =
    options.fallbackLineHeightPx ?? Math.ceil(lineHeight * 16);
  if (!text) return 0;
  if (width <= 0) return fallbackTextHeight(text, width, fallbackLineHeightPx);
  const key = `${text}|${font}|${width}|${lineHeight}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const prepared = prepare(text, font);
    const result = layout(prepared, width, lineHeight);
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, result.height);
    return result.height;
  } catch (e) {
    if (!didWarnMeasurementFailure && typeof window !== "undefined") {
      didWarnMeasurementFailure = true;
      devLog("warn", "pretext", "Text measurement failed", e);
    }
    return fallbackTextHeight(text, width, fallbackLineHeightPx);
  }
};

export function estimateTextareaHeight({
  text,
  width,
  minHeight,
  maxHeight,
  verticalPadding = 16,
}: {
  text: string;
  width: number;
  minHeight: number;
  maxHeight: number;
  verticalPadding?: number;
}) {
  if (!text.trim()) return minHeight;
  const measured = measureTextHeight(
    text,
    PRETEXT_FONTS.composer,
    Math.max(1, width),
    PRETEXT_LINE_HEIGHTS.composer,
    { fallbackLineHeightPx: 26 },
  );
  return Math.ceil(clamp(measured + verticalPadding, minHeight, maxHeight));
}

export function estimateLineClampHeight({
  text,
  font,
  width,
  lineHeightPx,
  minHeight,
  maxLines,
}: {
  text: string;
  font: string;
  width: number;
  lineHeightPx: number;
  minHeight: number;
  maxLines: number;
}) {
  const measured = measureTextHeight(text, font, width, lineHeightPx / 16, {
    fallbackLineHeightPx: lineHeightPx,
  });
  return Math.ceil(clamp(measured, minHeight, lineHeightPx * maxLines));
}
