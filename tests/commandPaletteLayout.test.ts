import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandSource = readFileSync("src/components/ui/command.tsx", "utf8");
const paletteSource = readFileSync("src/features/command-palette/CommandPalette.tsx", "utf8");

describe("command palette layout", () => {
  it("keeps the dialog centered and bounded on small windows", () => {
    expect(commandSource).not.toContain("top-1/3 translate-y-0");
    expect(paletteSource).not.toContain('className="mx-4 flex');
    expect(paletteSource).toContain("w-full");
    expect(paletteSource).toContain("sm:max-w-[600px]");
  });

  it("uses a compact search field radius", () => {
    expect(commandSource).toContain('data-slot="command-input-wrapper" className="p-3 pb-2"');
    expect(commandSource).toContain('className="h-9 rounded-full bg-input/50"');
  });
});
