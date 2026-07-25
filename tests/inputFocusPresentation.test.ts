import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("text inputs use a focus border without the shadcn focus halo", () => {
  const input = readFileSync("src/components/ui/input.tsx", "utf8");
  const textarea = readFileSync("src/components/ui/textarea.tsx", "utf8");
  const inputGroup = readFileSync("src/components/ui/input-group.tsx", "utf8");

  expect(input).not.toContain("focus-visible:ring-3");
  expect(textarea).not.toContain("focus-visible:ring-3");
  expect(inputGroup).not.toContain("focus-visible]:ring-3");
  expect(input).toContain("focus-visible:border-ring");
  expect(textarea).toContain("focus-visible:border-ring");
  expect(inputGroup).toContain("focus-visible]:border-ring");
});
