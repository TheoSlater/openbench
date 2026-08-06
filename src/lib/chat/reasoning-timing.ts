export type ReasoningTiming = {
  startedAt: number;
  endedAt?: number;
};

export function createReasoningTimings(): Map<number, ReasoningTiming> {
  return new Map();
}

export function observeReasoningParts(
  timings: Map<number, ReasoningTiming>,
  parts: readonly { type: string }[],
  now: number,
): void {
  for (const [index, part] of parts.entries()) {
    for (const [previousIndex, timing] of timings) {
      if (previousIndex < index && timing.endedAt === undefined) {
        timing.endedAt = now;
      }
    }
    if (part.type === "reasoning" && !timings.has(index)) {
      timings.set(index, { startedAt: now });
    }
  }
}

export function closeReasonings(
  timings: Map<number, ReasoningTiming>,
  now: number,
): void {
  for (const timing of timings.values()) {
    if (timing.endedAt === undefined) timing.endedAt = now;
  }
}

export function reasoningDurations(
  timings: Map<number, ReasoningTiming>,
  now: number,
): number[] {
  return [...timings.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, timing]) =>
      Math.max(0, (timing.endedAt ?? now) - timing.startedAt) / 1000,
    );
}

export const trackReasoning = observeReasoningParts;
export const closeReasoning = closeReasonings;
