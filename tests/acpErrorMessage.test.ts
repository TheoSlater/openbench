import { describe, expect, it } from "vitest";
import { needsReauthentication } from "@/lib/acp/errorMessage";

describe("coding-agent reauthentication", () => {
  it("recognizes a preserved 401 and conservative expiry messages", () => {
    expect(needsReauthentication({ kind: "agent", code: 401, message: "request failed" }))
      .toBe(true);
    expect(needsReauthentication({
      kind: "transport",
      message: "Authentication expired",
      exit_code: null,
      stderr_tail: null,
    })).toBe(true);
    expect(needsReauthentication({
      kind: "agent",
      code: 500,
      message: "authentication server unavailable",
    })).toBe(false);
  });
});
