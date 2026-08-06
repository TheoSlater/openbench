import { describe, expect, it, vi } from "vitest";
import {
  applyRuntimeEvent,
  MAX_API_CALLS,
} from "@/features/debug-overlay/apiCalls";
import type { ApiCallEntry } from "@/features/debug-overlay/types";

function entry(overrides: Partial<ApiCallEntry> = {}): ApiCallEntry {
  return {
    requestId: "req-1",
    status: "streaming",
    startedAt: 1000,
    chunkCount: 0,
    ...overrides,
  };
}

describe("applyRuntimeEvent", () => {
  it("opens a streaming entry when a chunk arrives for a new request", () => {
    const next = applyRuntimeEvent([], {
      type: "chunk",
      request_id: "req-1",
      chunk: {} as never,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      requestId: "req-1",
      status: "streaming",
      chunkCount: 1,
      startedAt: expect.any(Number),
    });
  });

  it("increments the chunk count without duplicating the entry", () => {
    const calls = [entry({ chunkCount: 3 })];
    const next = applyRuntimeEvent(calls, {
      type: "chunk",
      request_id: "req-1",
      chunk: {} as never,
    });

    expect(next).toHaveLength(1);
    expect(next[0].chunkCount).toBe(4);
  });

  it("marks a request as success when done arrives", () => {
    const calls = [entry({ startedAt: 1000 })];
    const next = applyRuntimeEvent(calls, {
      type: "done",
      request_id: "req-1",
    });

    expect(next[0]).toMatchObject({
      status: "success",
      finishedAt: expect.any(Number),
    });
  });

  it("marks a request as error with the message when error arrives", () => {
    const calls = [entry()];
    const next = applyRuntimeEvent(calls, {
      type: "error",
      request_id: "req-1",
      error: "rate limited",
    });

    expect(next[0]).toMatchObject({
      status: "error",
      error: "rate limited",
      finishedAt: expect.any(Number),
    });
  });

  it("records an error even when no chunk was ever seen for the request", () => {
    const next = applyRuntimeEvent([], {
      type: "error",
      request_id: "req-ghost",
      error: "sidecar died",
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      requestId: "req-ghost",
      status: "error",
      error: "sidecar died",
    });
  });

  it("ignores done events for unknown requests", () => {
    const next = applyRuntimeEvent([], {
      type: "done",
      request_id: "req-unknown",
    });

    expect(next).toHaveLength(0);
  });

  it("keeps only the most recent calls and drops the oldest", () => {
    const calls = Array.from({ length: MAX_API_CALLS }, (_, index) =>
      entry({ requestId: `req-${index}`, startedAt: 1000 + index }),
    );

    const next = applyRuntimeEvent(calls, {
      type: "chunk",
      request_id: "req-new",
      chunk: {} as never,
    });

    expect(next).toHaveLength(MAX_API_CALLS);
    expect(next[0].requestId).toBe("req-new");
    expect(next.some((call) => call.requestId === "req-0")).toBe(false);
  });
});
