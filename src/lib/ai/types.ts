export type AgentEvent =
  | {
    kind: "permission";
    approvalId: string;
    status: "pending" | "approved" | "denied";
    action: string;
    requestId?: string;
    command?: string;
    paths?: string[];
    cwd?: string;
  }
  | { kind: "plan" | "task"; id: string; text: string; status: string }
  | { kind: "terminal"; id: string; command?: string; cwd?: string; status: string }
  | { kind: "file"; id: string; paths?: string[]; status: string };

export type PolyUIData = { agent: AgentEvent };
