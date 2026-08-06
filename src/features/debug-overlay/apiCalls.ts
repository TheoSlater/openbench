import type { ApiCallEntry, DebugOverlayRuntimeEvent } from "./types";

export const MAX_API_CALLS = 8;

function prependCall(calls: ApiCallEntry[], call: ApiCallEntry): ApiCallEntry[] {
  if (calls.length < MAX_API_CALLS) return [call, ...calls];
  const oldestIndex = calls.reduce(
    (oldest, current, index) => (current.startedAt < calls[oldest].startedAt ? index : oldest),
    0,
  );
  return [call, ...calls.filter((_, index) => index !== oldestIndex)];
}

export function applyRuntimeEvent(
  calls: ApiCallEntry[],
  event: DebugOverlayRuntimeEvent,
): ApiCallEntry[] {
  switch (event.type) {
    case "chunk": {
      const existing = calls.find((call) => call.requestId === event.request_id);
      if (existing) {
        return calls.map((call) =>
          call.requestId === event.request_id
            ? { ...call, chunkCount: call.chunkCount + 1 }
            : call,
        );
      }
      return prependCall(calls, {
        requestId: event.request_id,
        status: "streaming",
        startedAt: Date.now(),
        chunkCount: 1,
      });
    }
    case "done": {
      return calls.map((call) =>
        call.requestId === event.request_id
          ? { ...call, status: "success" as const, finishedAt: Date.now() }
          : call,
      );
    }
    case "error": {
      const existing = calls.find((call) => call.requestId === event.request_id);
      if (existing) {
        return calls.map((call) =>
          call.requestId === event.request_id
            ? { ...call, status: "error" as const, finishedAt: Date.now(), error: event.error }
            : call,
        );
      }
      return prependCall(calls, {
        requestId: event.request_id,
        status: "error" as const,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        chunkCount: 0,
        error: event.error,
      });
    }
  }
}