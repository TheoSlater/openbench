// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentIcon } from "@/features/coding-agents/AgentIcon";

describe("coding agent icons", () => {
  it.each([
    ["codex", "/icons/codex.svg"],
    ["claude-code", "/icons/claude.svg"],
  ] as const)("uses the public %s glyph", (kind, path) => {
    const { container } = render(<AgentIcon kind={kind} />);
    expect((container.firstElementChild as HTMLElement).style.mask)
      .toBe(`url("${path}") center / contain no-repeat`);
  });
});
