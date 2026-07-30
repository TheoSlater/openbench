import { describe, expect, it } from "vitest";
import type { AcpEvent } from "@/generated/bindings/AcpEvent";
import { reduceAcpActivity, initialAcpActivity } from "@/features/acp/activity-reducer";

describe("ACP activity reducer", () => {
  it("groups message chunks and clears thinking on completion", () => {
    const events: AcpEvent[] = [
      { type: "agent-thought", session_id: "s", text: "checking" },
      { type: "agent-message", session_id: "s", text: "Hello" },
      { type: "agent-message", session_id: "s", text: " world" },
      { type: "turn-ended", session_id: "s", stop_reason: "end-turn" },
    ];
    const state = events.reduce(reduceAcpActivity, initialAcpActivity("c"));
    expect(state.answer).toBe("Hello world");
    expect(state.thought).toBe("checking");
    expect(state.thinking).toBe(false);
    expect(state.status).toBe("completed");
  });

  it("withdraws an open permission when process dies", () => {
    const requested: AcpEvent = {
      type: "permission-requested",
      session_id: "s",
      request: {
        request_id: "p",
        session_id: "s",
        action: "Run command",
        tool_call_id: "t",
        tool_kind: "execute",
        affected_paths: [],
        command: "echo ok",
        raw_input: null,
        working_directory: "/tmp/work",
        choices: [{ option_id: "deny", name: "Deny", kind: "reject-once" }],
      },
    };
    const failed: AcpEvent = {
      type: "failed",
      session_id: "s",
      error: { kind: "transport", message: "process exited", exit_code: 1, stderr_tail: null },
    };
    const state = [requested, failed].reduce(
      reduceAcpActivity,
      initialAcpActivity("c"),
    );
    expect(state.permission).toBeNull();
    expect(state.status).toBe("failed");
  });
});
