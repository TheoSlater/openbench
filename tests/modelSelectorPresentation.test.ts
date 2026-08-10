import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("model selector reads the shared catalog in native popover flow", () => {
  const source = readFileSync("src/features/chat/components/ModelSelector.tsx", "utf8");

  expect(source).toContain("useRuntimeCatalogStore");
  expect(source).toContain("runtimeOptionsFromCatalog");
  expect(source).not.toContain("useVirtualizer");
  expect(source).not.toContain("translateY(");
  expect(source).toContain("Manage connections");
  expect(source).not.toContain("loadModels(");
});
