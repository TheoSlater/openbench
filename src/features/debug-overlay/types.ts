export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type DebugStats = {
  seq: number;
  cpuPercent: number;
  memTotalMb: number;
  memUsedMb: number;
  appMemMb: number;
};

export type ApiCallStatus = "streaming" | "success" | "error";

export type ApiCallEntry = {
  requestId: string;
  status: ApiCallStatus;
  startedAt: number;
  finishedAt?: number;
  chunkCount: number;
  error?: string;
};

export type DebugOverlayRuntimeEvent =
  | { type: "chunk"; request_id: string; chunk: unknown }
  | { type: "done"; request_id: string }
  | { type: "error"; request_id: string; error: string };

export type DevLogLevel = "debug" | "info" | "warn" | "error";
