import type { AcpError } from "@/generated/bindings/AcpError";
import type { AcpEvent } from "@/generated/bindings/AcpEvent";
import type { AgentDescriptor } from "@/generated/bindings/AgentDescriptor";
import type { PermissionRequest } from "@/generated/bindings/PermissionRequest";
import type { PlanStep } from "@/generated/bindings/PlanStep";
import type { ToolActivity } from "@/generated/bindings/ToolActivity";

export type AcpActivityState = {
  conversationId: string;
  sessionId: string | null;
  descriptor: AgentDescriptor | null;
  answer: string;
  thought: string;
  thinking: boolean;
  tools: Record<string, ToolActivity>;
  plan: PlanStep[];
  commands: string[];
  permission: PermissionRequest | null;
  error: AcpError | null;
  lagged: number;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
};

export const initialAcpActivity = (conversationId: string): AcpActivityState => ({
  conversationId,
  sessionId: null,
  descriptor: null,
  answer: "",
  thought: "",
  thinking: false,
  tools: {},
  plan: [],
  commands: [],
  permission: null,
  error: null,
  lagged: 0,
  status: "idle",
});

export function reduceAcpActivity(
  state: AcpActivityState,
  event: AcpEvent,
): AcpActivityState {
  switch (event.type) {
    case "session-started":
      return {
        ...state,
        sessionId: event.session_id,
        descriptor: event.descriptor,
        status: "running",
      };
    case "agent-message":
      return {
        ...state,
        sessionId: event.session_id,
        answer: state.answer + event.text,
        thinking: false,
        status: "running",
      };
    case "agent-thought":
      return {
        ...state,
        sessionId: event.session_id,
        thought: state.thought + event.text,
        thinking: true,
        status: "running",
      };
    case "tool-activity":
      return {
        ...state,
        tools: {
          ...state.tools,
          [event.activity.tool_call_id]: {
            ...state.tools[event.activity.tool_call_id],
            ...event.activity,
          },
        },
      };
    case "plan":
      return { ...state, plan: event.steps };
    case "available-commands":
      return { ...state, commands: event.commands };
    case "permission-requested":
      return { ...state, permission: event.request };
    case "permission-withdrawn":
      return state.permission?.request_id === event.request_id
        ? { ...state, permission: null }
        : state;
    case "turn-ended":
      return {
        ...state,
        permission: null,
        thinking: false,
        status: event.stop_reason === "cancelled" ? "cancelled" : "completed",
      };
    case "failed":
      return {
        ...state,
        permission: null,
        thinking: false,
        error: event.error,
        status: "failed",
      };
    case "lagged":
      return { ...state, lagged: state.lagged + event.dropped };
    case "user-message":
    case "mode-changed":
    case "meta":
      return state;
  }
}
