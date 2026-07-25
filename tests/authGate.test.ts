import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/auth/AuthModal.tsx", "utf8");

describe("auth gate", () => {
  it("cannot be dismissed without signing in or continuing as guest", () => {
    // The gate renders over the app. If Escape or an outside click could close
    // it, an unauthenticated user would land straight in the UI behind it.
    expect(source).toContain("onEscapeKeyDown");
    expect(source).toContain("onInteractOutside");
    expect(source).toContain("showCloseButton={false}");
    expect(source).toContain("skipAuth");
  });

  it("is labelled by a real DialogTitle", () => {
    // Radix needs a Title for the dialog's accessible name; the old
    // hand-rolled modal pointed aria-labelledby at a bare <h2>.
    expect(source).toContain("<DialogTitle");
    expect(source).not.toContain('aria-labelledby="auth-dialog-title"');
  });
});
