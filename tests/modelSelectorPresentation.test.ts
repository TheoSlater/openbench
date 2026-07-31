import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("model selector empty state has inset spacing", () => {
  const source = readFileSync("src/features/chat/components/ModelSelectorOption.tsx", "utf8");

  expect(source).toContain('className="flex items-center gap-2 px-3 py-4"');
});

test("model selector refreshes and virtualizes connected provider catalogs", () => {
  const source = readFileSync("src/features/chat/components/ModelSelector.tsx", "utf8");

  expect(source).toContain("loadModels(item.connection.id, true)");
  expect(source).toContain("useVirtualizer");
  expect(source).toContain("overscan: 8");
});
