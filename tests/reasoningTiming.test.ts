import { describe, expect, it } from "vitest";
import {
  closeReasonings,
  createReasoningTimings,
  observeReasoningParts,
  reasoningDurations,
} from "@/lib/chat/reasoning-timing";

describe("reasoning timing", () => {
  it("times each reasoning block independently", () => {
    const timing = createReasoningTimings();

    observeReasoningParts(timing, [{ type: "reasoning" }], 1_000);
    observeReasoningParts(
      timing,
      [{ type: "reasoning" }, { type: "text" }],
      3_000,
    );
    observeReasoningParts(
      timing,
      [{ type: "reasoning" }, { type: "text" }, { type: "reasoning" }],
      4_000,
    );
    closeReasonings(timing, 6_000);

    expect(reasoningDurations(timing, 6_000)).toEqual([2, 2]);
  });
});
