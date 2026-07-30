// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionsTab } from "@/features/settings/tabs/ConnectionsTab";

const actions = {
  load: vi.fn().mockResolvedValue(undefined),
  loadModels: vi.fn(),
  remove: vi.fn(),
};
const connectionState = { summaries: [], models: {}, loading: false, error: null, actions };

vi.mock("@/features/connections/store", () => ({
  useConnectionsStore: (selector?: (state: typeof connectionState) => unknown) =>
    selector ? selector(connectionState) : connectionState,
}));
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector?: (state: { codex: object; claude: object }) => unknown) => {
    const state = { codex: {}, claude: {} };
    return selector ? selector(state) : state;
  },
}));
vi.mock("@/features/providers", () => ({
  getCurrentProviderAccountId: () => "fresh-account",
}));
vi.mock("@/features/codex/codexClient", () => ({
  codexStatus: vi.fn().mockResolvedValue({
    state: { state: "unknown" },
    primary_action: "none",
    usable: false,
  }),
  codexVerify: vi.fn(),
  codexAuthenticate: vi.fn(),
  codexCancelAuthenticate: vi.fn(),
}));
vi.mock("@/features/claude/claudeClient", () => ({
  claudeStatus: vi.fn().mockResolvedValue({
    state: { state: "unknown" },
    primary_action: "none",
    usable: false,
  }),
  claudeVerify: vi.fn(),
  claudeAuthenticate: vi.fn(),
  claudeCancelAuthenticate: vi.fn(),
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
