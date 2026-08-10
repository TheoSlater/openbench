// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionsTab } from "@/features/settings/tabs/ConnectionsTab";

const actions = {
  start: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  refreshConnection: vi.fn().mockResolvedValue(undefined),
  refreshAgent: vi.fn().mockResolvedValue(undefined),
  removeConnection: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
};
const agent = (kind: "codex" | "claude-code") => ({
  kind,
  status: null,
  statusState: "idle",
  models: [],
  modelsState: "idle",
  error: null,
});
const catalogState = {
  connections: [],
  modelsByConnection: {},
  refreshingConnectionIds: new Set<string>(),
  agents: { codex: agent("codex"), "claude-code": agent("claude-code") },
  status: "ready",
  error: null,
  actions,
};

vi.mock("@/features/runtime/catalog-store", () => ({
  useRuntimeCatalogStore: (selector?: (state: typeof catalogState) => unknown) =>
    selector ? selector(catalogState) : catalogState,
}));
vi.mock("@/features/providers", () => ({
  getCurrentProviderAccountId: () => "fresh-account",
}));

describe("fresh profile connections", () => {
  it("shows no provider cards", () => {
    const { container } = render(
      <TooltipProvider>
        <ConnectionsTab />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "Add connection" })).toBeTruthy();
    expect(screen.getByText("Add a cloud, local, or custom model connection.")).toBeTruthy();
    expect(container.querySelectorAll("[data-slot=card]")).toHaveLength(2);
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
    expect(screen.queryByText("Google Gemini")).toBeNull();
  });
});
