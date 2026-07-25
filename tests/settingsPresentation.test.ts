import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings presentation", () => {
  it("keeps tab names in navigation instead of repeating them as panel headings", () => {
    const modal = readFileSync("src/features/settings/SettingsModal.tsx", "utf8");
    const shell = readFileSync("src/features/settings/SettingsShell.tsx", "utf8");

    expect(modal).not.toContain("title={activeItem.label}");
    expect(shell).not.toContain("<h2");
  });

  it("reuses README Shields badges in About", () => {
    const about = readFileSync("src/features/settings/tabs/AboutTab.tsx", "utf8");

    expect(about).toContain("img.shields.io/github/stars/monolabsdev/poly-ui");
    expect(about).toContain("img.shields.io/github/last-commit/monolabsdev/poly-ui");
  });
});
