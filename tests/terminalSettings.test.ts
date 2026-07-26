import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/features/settings/tabs/AdvancedSettingsContent.tsx",
  "utf8",
);

describe("advanced feature tiers", () => {
  it("groups beta terminal selection behind the beta master toggle", () => {
    expect(source).toContain("Enable experimental features");
    expect(source).toContain("Enable beta features");
    expect(source).toContain("Enable preview features");
    expect(source).toContain("Terminal (Beta)");
    expect(source).toContain("Native PTY (xterm.js)");
    expect(source).toContain("disabled={!betaFeatures}");
  });
});
