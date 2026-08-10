import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("window resize borders", () => {
  it("covers every undecorated desktop build", () => {
    const source = readFileSync(
      "src/components/WindowResizeBorders.tsx",
      "utf8",
    );

    expect(source).toContain("USE_CUSTOM_WINDOW_CONTROLS");
    expect(source).not.toContain("IS_LINUX");
    expect(source).toContain("if (!USE_CUSTOM_WINDOW_CONTROLS) return;");
    expect(source).toContain(
      "if (!USE_CUSTOM_WINDOW_CONTROLS || maximized) return null;",
    );
  });
});
