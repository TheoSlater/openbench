import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("reset all data", () => {
  it("exposes a destructive settings reset and clears browser state after backend success", () => {
    const profile = readFileSync(`${root}/src/features/settings/tabs/ProfileTab.tsx`, "utf8");
    const reset = readFileSync(`${root}/src/features/settings/resetAllData.ts`, "utf8");

    expect(profile).toContain("Reset all data");
    expect(profile).toContain("ConfirmDialog");
    expect(reset).toContain('invoke("reset_local_data")');
    expect(reset).toContain("localStorage.clear()");
    expect(reset).toContain("sessionStorage.clear()");
    expect(reset).toContain("window.location.reload()");
  });
});
