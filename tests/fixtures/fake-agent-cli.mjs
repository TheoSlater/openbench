#!/usr/bin/env node
import readline from "node:readline";

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const appServer = process.argv.includes("app-server");

if (!appServer) {
  let sent = false;
  process.stdin.on("data", () => {
    if (sent) return;
    sent = true;
    const resumeAt = process.argv.indexOf("--resume");
    const session = resumeAt >= 0 ? process.argv[resumeAt + 1] : "claude-session-new";
    send({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      session_id: session,
      tools: [],
      mcp_servers: [],
      model: "sonnet",
      permissionMode: "default",
      slash_commands: [],
      apiKeySource: "none",
      claude_code_version: "2.1.0",
      output_style: "default",
      agents: [],
      skills: [],
      plugins: [],
    });
    send({
      type: "assistant",
      message: {
        id: "message-1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet",
        content: [{ type: "text", text: resumeAt >= 0 ? `resumed:${session}` : "claude ready" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 2 },
      },
      parent_tool_use_id: null,
      session_id: session,
      uuid: "assistant-1",
    });
    send({
      type: "result",
      subtype: "success",
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: "ok",
      session_id: session,
      total_cost_usd: 0,
      usage: { input_tokens: 2, output_tokens: 2 },
      modelUsage: {},
      permission_denials: [],
      uuid: "result-1",
    });
  });
} else {
  const lines = readline.createInterface({ input: process.stdin });
  const threadId = `codex-thread-${process.pid}`;
  let turnId = "turn-0";
  let pendingApproval;
  let resumed = false;
  const commandItem = (status) => ({
    type: "commandExecution",
    id: "command-1",
    command: "echo safe",
    cwd: process.cwd(),
    processId: null,
    status,
    commandActions: [],
    aggregatedOutput: status === "completed" ? "safe\n" : null,
    exitCode: status === "completed" ? 0 : null,
    durationMs: status === "completed" ? 1 : null,
  });

  const finishTurn = (text = "codex ready", status = "completed") => {
    send({
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId: "message-1", delta: text },
    });
    send({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, items: [], status, error: null } },
    });
  };

  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === pendingApproval) {
      pendingApproval = undefined;
      send({
        method: "item/completed",
        params: { threadId, turnId, item: commandItem("completed") },
      });
      finishTurn(message.result?.decision === "accept" ? "approved" : "declined");
      return;
    }
    if (message.id === undefined) return;
    if (message.method === "initialize") {
      send({ id: message.id, result: { userAgent: "codex-cli/0.144.0", capabilities: { modelList: true } } });
    } else if (message.method === "model/list") {
      send({ id: message.id, result: { data: [{ id: "gpt-5.2-codex", isDefault: true }], nextCursor: null } });
    } else if (message.method === "thread/start") {
      resumed = false;
      send({ id: message.id, result: { thread: { id: threadId } } });
    } else if (message.method === "thread/resume") {
      resumed = true;
      send({ id: message.id, result: { thread: { id: message.params.threadId } } });
    } else if (message.method === "turn/start") {
      turnId = `turn-${Number(turnId.split("-")[1]) + 1}`;
      send({ id: message.id, result: { turn: { id: turnId, items: [], status: "inProgress", error: null } } });
      const prompt = message.params.input?.map((part) => part.text ?? "").join("") ?? "";
      if (prompt.includes("[approval]")) {
        pendingApproval = `approval-${turnId}`;
        send({
          method: "item/started",
          params: { threadId, turnId, item: commandItem("inProgress") },
        });
        send({
          id: pendingApproval,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId,
            itemId: "command-1",
            approvalId: pendingApproval,
            command: "echo safe",
            cwd: process.cwd(),
            reason: "Run command",
          },
        });
      } else if (!prompt.includes("[cancel]")) {
        finishTurn(resumed ? "resumed" : "codex ready");
      }
    } else if (message.method === "turn/interrupt") {
      send({ id: message.id, result: {} });
      finishTurn("", "interrupted");
    }
  });
}

process.on("SIGTERM", () => process.exit(0));
