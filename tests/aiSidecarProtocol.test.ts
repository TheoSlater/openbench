import { describe, expect, it } from "vitest";
import {
  assertNoFrontendSecrets,
  encodeRecord,
  parseCommand,
  redact,
} from "../sidecar/src/protocol";

describe("AI sidecar protocol", () => {
  it("accepts a request-scoped chat command", () => {
    expect(parseCommand(JSON.stringify({
      type: "chat",
      requestId: "req-1",
      connection: {
        id: "conn-1",
        provider: "openai",
        modelId: "gpt-5",
        secret: "sk-private",
      },
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    }))).toMatchObject({ type: "chat", requestId: "req-1" });
  });

  it("accepts an optional terminal-tool flag", () => {
    const parsed = parseCommand(JSON.stringify({
      type: "chat",
      requestId: "req-1",
      terminal: true,
      connection: {
        id: "conn-1",
        provider: "openai",
        modelId: "gpt-5",
        secret: "sk-private",
      },
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    }));
    expect(parsed).toMatchObject({ terminal: true });
  });

  it("accepts a pty-data relay command", () => {
    const parsed = parseCommand(JSON.stringify({
      type: "pty-data",
      requestId: "call-1",
      payload: { data: [104, 105] },
    }));
    expect(parsed).toMatchObject({
      type: "pty-data",
      requestId: "call-1",
      payload: { data: [104, 105] },
    });
  });

  it("accepts a pty-exit relay command with a nullable exit code", () => {
    const parsed = parseCommand(JSON.stringify({
      type: "pty-exit",
      requestId: "call-1",
      payload: { exitCode: 0 },
    }));
    expect(parsed).toMatchObject({ type: "pty-exit", payload: { exitCode: 0 } });

    const unknown = parseCommand(JSON.stringify({
      type: "pty-exit",
      requestId: "call-2",
      payload: { exitCode: null },
    }));
    expect(unknown).toMatchObject({ payload: { exitCode: null } });
  });

  it("rejects a pty command without a payload", () => {
    expect(() => parseCommand(JSON.stringify({
      type: "pty-data",
      requestId: "call-1",
    }))).toThrow();
  });

  it("normalizes Rust null optionals without weakening required fields", () => {    const parsed = parseCommand(JSON.stringify({
      type: "agent",
      requestId: "req-agent",
      responseMessageId: null,
      conversationId: "conv",
      agent: {
        kind: "codex",
        workspace: "/tmp/project",
        accessMode: "workspace-write",
        executablePath: null,
        modelId: null,
        sessionId: null,
      },
      messages: [],
      instructions: null,
      reasoning: null,
    }));
    expect(parsed).toMatchObject({ type: "agent", requestId: "req-agent" });
    expect(parsed).not.toHaveProperty("agent.sessionId", null);
  });

  it.each(["apiKey", "api_key", "credential", "authorization"])(
    "rejects frontend-owned %s fields",
    (field) => {
      expect(() => assertNoFrontendSecrets({
        connectionId: "conn-1",
        nested: { [field]: "secret" },
      })).toThrow(/secret-bearing field/i);
    },
  );

  it("redacts known secrets recursively", () => {
    const value = {
      secret: "sk-private",
      headers: { Authorization: "Bearer private", harmless: "ok" },
      nested: [{ api_key: "gemini-private" }],
    };
    expect(JSON.stringify(redact(value))).toBe(
      '{"secret":"[REDACTED]","headers":{"Authorization":"[REDACTED]","harmless":"ok"},"nested":[{"api_key":"[REDACTED]"}]}',
    );
  });

  it("never serializes an error cause or secret value", () => {
    const encoded = encodeRecord({
      type: "error",
      requestId: "req-1",
      error: new Error("provider rejected sk-private", {
        cause: { authorization: "Bearer private" },
      }),
    }, ["sk-private", "Bearer private"]);

    expect(encoded).not.toContain("sk-private");
    expect(encoded).not.toContain("Bearer private");
    expect(encoded).not.toContain("cause");
    expect(JSON.parse(encoded)).toEqual({
      type: "error",
      requestId: "req-1",
      error: "provider rejected [REDACTED]",
    });
  });
});
