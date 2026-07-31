export type AgentEvent = {
  kind: "permission";
  approvalId: string;
  status: "pending" | "approved" | "denied";
  action: string;
  requestId?: string;
  command?: string;
  paths?: string[];
  cwd?: string;
};

export type PolyUIData = { agent: AgentEvent };
