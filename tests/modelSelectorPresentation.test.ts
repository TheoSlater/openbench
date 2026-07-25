import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("model selector empty state has inset spacing", () => {
  const source = readFileSync("src/features/chat/components/ModelSelectorOption.tsx", "utf8");

  expect(source).toContain('className="flex items-center gap-2 px-3 py-4"');
});
