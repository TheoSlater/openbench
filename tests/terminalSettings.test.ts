import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/features/settings/tabs/AdvancedSettingsContent.tsx",
  "utf8",
);

describe("advanced feature tiers", () => {
  it("exposes feature tier toggles without a terminal renderer picker", () => {
    expect(source).toContain("Enable experimental features");
    expect(source).toContain("Enable beta features");
    expect(source).toContain("Enable preview features");
    expect(source).not.toContain("Native PTY (Ghostty)");
    expect(source).not.toContain("Native PTY (xterm.js)");
    expect(source).not.toContain("Just Bash (Browser)");
    expect(source).not.toContain("terminalEmulator");
  });
});
