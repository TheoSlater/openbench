import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

// jsdom has no layout engine, so this cannot assert the rendered geometry.
// It guards the class list instead, which is where the bug lived.
describe("chat workspace fills the workspace row", () => {
  it("does not set an explicit height on the workspace panel", () => {
    const source = read("src/features/chat/components/ChatWorkspace.tsx");
    // The workspace panel is the only element carrying bg-background here.
    const root = source
      .split("\n")
      .find((line) => line.includes("flex-col bg-background"));
    expect(root, "workspace root class list not found").toBeTruthy();

    // `h-full` on this element makes the panel depend on its parent having a
    // definite height. WebKitGTK does not reliably give it one: the panel
    // collapsed to its content height (321px inside a 403px row), leaving a
    // gap below the composer until the window was resized.
    expect(root).not.toContain("h-full");
    // Stretch is what fills the cross axis; flex-1 sizes it along the row.
    expect(root).toContain("flex-1");
    expect(root).toContain("min-h-0");
  });
});
