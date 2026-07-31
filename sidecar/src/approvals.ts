import type { AgentEvent } from "../../src/lib/ai/types";
export type { AgentEvent } from "../../src/lib/ai/types";
type PermissionEvent = Extract<AgentEvent, { kind: "permission" }>;

type Decision = { approved: boolean; reason?: string };
type Pending = { requestId: string; resolve: (decision: Decision) => void };

export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly emit: (event: PermissionEvent, requestId: string) => void) {}

  request(
    requestId: string,
    approvalId: string,
    detail: Omit<PermissionEvent, "kind" | "approvalId" | "status">,
    signal?: AbortSignal,
  ): Promise<Decision> {
    const key = `${requestId}:${approvalId}`;
    if (this.pending.has(key)) throw new Error(`Duplicate approval: ${approvalId}`);
    this.emit({ kind: "permission", approvalId, status: "pending", ...detail }, requestId);
    return new Promise((resolve) => {
      const finish = (decision: Decision) => {
        this.pending.delete(key);
        this.emit({
          kind: "permission",
          approvalId,
          status: decision.approved ? "approved" : "denied",
          ...detail,
        }, requestId);
        resolve(decision);
      };
      this.pending.set(key, { requestId, resolve: finish });
      signal?.addEventListener("abort", () => finish({ approved: false, reason: "cancelled" }), {
        once: true,
      });
    });
  }

  resolve(requestId: string, approvalId: string, approved: boolean, reason?: string): boolean {
    const pending = this.pending.get(`${requestId}:${approvalId}`);
    pending?.resolve({ approved, reason });
    return Boolean(pending);
  }

  cancel(requestId: string): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.requestId === requestId) pending.resolve({ approved: false, reason: "cancelled" });
    }
  }
}
