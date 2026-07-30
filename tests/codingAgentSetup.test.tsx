// @vitest-environment jsdom

import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CodingAgentCard, type CardStatus } from "@/features/coding-agents/CodingAgentCard";
import { CodingAgentSetup, type AnySetupView } from "@/features/coding-agents/CodingAgentSetup";
import { CARD_STATUS, CLAUDE_AGENT, CODEX_AGENT } from "@/features/coding-agents/setupCopy";

function renderWithTooltips(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const installAdapter = vi.fn();
const adapterInstallPlan = vi.fn();

vi.mock("@/features/acp/adapter-install-client", () => ({
  adapterInstallPlan: (...args: unknown[]) => adapterInstallPlan(...args),
  installAdapter: (...args: unknown[]) => installAdapter(...args),
}));

function ready(adapterPath = "/bin/codex-acp"): AnySetupView {
  return { state: { state: "ready", adapter_path: adapterPath }, primary_action: "none", usable: true };
}
function unknown(): AnySetupView {
  return { state: { state: "unknown" }, primary_action: "none", usable: false };
}
function notInstalled(): AnySetupView {
  return { state: { state: "not-installed", reason: null }, primary_action: "set-up", usable: false };
}
function adapterMissing(): AnySetupView {
  return { state: { state: "adapter-missing", reason: null }, primary_action: "set-up", usable: false };
}
function adapterOutdated(): AnySetupView {
  return {
    state: { state: "adapter-outdated", adapter_path: "/bin/codex-acp", version: "1.0.0" },
    primary_action: "set-up",
    usable: false,
  };
}
function authRequired(adapterPath = "/bin/codex-acp"): AnySetupView {
  return {
    state: { state: "authentication-required", adapter_path: adapterPath },
    primary_action: "sign-in",
    usable: false,
  };
}
function cliLoginRequired(adapterPath = "/bin/codex-acp"): AnySetupView {
  return {
    state: { state: "cli-login-required", adapter_path: adapterPath },
    primary_action: "sign-in",
    usable: false,
  };
}
function crashed(message = "the process exited unexpectedly"): AnySetupView {
  return {
    state: { state: "crashed", adapter_path: "/bin/codex-acp", message },
    primary_action: "retry",
    usable: false,
  };
}

beforeEach(() => {
  installAdapter.mockReset();
  adapterInstallPlan.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodingAgentCard", () => {
  const statuses: Array<[string, CardStatus | null]> = [
    ["detecting", null],
    ["ready", { primaryAction: "none", state: "ready" }],
    ["set-up", { primaryAction: "set-up", state: "adapter-missing" }],
    ["retry", { primaryAction: "retry", state: "crashed", diagnostic: "boom" }],
  ];

  it("renders identical structure for both agents across all four states", () => {
    for (const [, status] of statuses) {
      const codex = renderWithTooltips(
        <CodingAgentCard agent={CODEX_AGENT} logo="⬡" status={status} onOpenSetup={() => {}} />,
      );
      const claude = renderWithTooltips(
        <CodingAgentCard agent={CLAUDE_AGENT} logo="✳" status={status} onOpenSetup={() => {}} />,
      );

      const codexCard = codex.container.querySelector("[data-slot=card]");
      const claudeCard = claude.container.querySelector("[data-slot=card]");
      expect(codexCard?.className).toBe(claudeCard?.className);

      codex.unmount();
      claude.unmount();
    }
  });

  it("keeps the card's dimensions stable across every state", () => {
    const classNames = statuses.map(([, status]) => {
      const { container, unmount } = renderWithTooltips(
        <CodingAgentCard agent={CODEX_AGENT} logo="⬡" status={status} onOpenSetup={() => {}} />,
      );
      const className = container.querySelector("[data-slot=card]")?.className;
      unmount();
      return className;
    });

    expect(new Set(classNames).size).toBe(1);
  });

  it("takes status wording from the shared table, not an agent-specific string", () => {
    const { getByText: codexText } = renderWithTooltips(
      <CodingAgentCard
        agent={CODEX_AGENT}
        logo="⬡"
        status={{ primaryAction: "none", state: "ready" }}
        onOpenSetup={() => {}}
      />,
    );
    expect(codexText(CARD_STATUS.ready)).toBeTruthy();

    const { getByText: claudeText } = renderWithTooltips(
      <CodingAgentCard
        agent={CLAUDE_AGENT}
        logo="✳"
        status={{ primaryAction: "set-up", state: "adapter-missing" }}
        onOpenSetup={() => {}}
      />,
    );
    expect(claudeText(CARD_STATUS.setUp)).toBeTruthy();
  });

  it("shows a skeleton, not a button, while detecting", () => {
    const { container } = renderWithTooltips(
      <CodingAgentCard agent={CODEX_AGENT} logo="⬡" status={null} onOpenSetup={() => {}} />,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("CodingAgentSetup", () => {
  it("paints a stored verification as READY with zero process spawns", async () => {
    const status = vi.fn().mockResolvedValue(ready());
    const verify = vi.fn();

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    await screen.findByText(CARD_STATUS.ready);
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps a cold record as a skeleton instead of Set up", async () => {
    const status = vi.fn().mockResolvedValue(unknown());
    const verify = vi.fn().mockReturnValue(new Promise<AnySetupView>(() => {}));

    const { container } = renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(container.querySelector("[data-slot=skeleton]")).toBeTruthy();
    expect(screen.queryByText(CARD_STATUS.setUp)).toBeNull();
  });

  it("settles a cold record after the settings-only verification", async () => {
    const verify = vi.fn().mockResolvedValue(adapterMissing());

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={vi.fn().mockResolvedValue(unknown())}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    await screen.findByText(CARD_STATUS.setUp);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("never spawns a process just from rendering the settings page", async () => {
    const status = vi.fn().mockResolvedValue(ready());
    const verify = vi.fn();

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    expect(verify).not.toHaveBeenCalled();
    expect(installAdapter).not.toHaveBeenCalled();
  });

  it("requires one explicit confirmation before installing, and never renders a URL, token, or credential path", async () => {
    const status = vi.fn().mockResolvedValue(adapterMissing());
    const verify = vi.fn().mockResolvedValue(ready());
    adapterInstallPlan.mockResolvedValue({
      package: "@agentclientprotocol/codex-acp",
      command: 'npm install --prefix "/data/codex" --omit=dev @agentclientprotocol/codex-acp',
      adapter_path: "/data/codex/node_modules/.bin/codex-acp",
    });

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.setUp));

    const installButton = await screen.findByRole("button", { name: "Install" });
    expect(installAdapter).not.toHaveBeenCalled();

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/https?:\/\//i);
    expect(body.toLowerCase()).not.toContain("token");
    expect(body.toLowerCase()).not.toContain("oauth");
    expect(body.toLowerCase()).not.toContain("authorize");
    expect(body.toLowerCase()).not.toContain("client_id");
    expect(body.toLowerCase()).not.toContain("api_key");
    expect(body.toLowerCase()).not.toContain("api key");

    fireEvent.click(installButton);
    await waitFor(() => expect(installAdapter).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  });

  it("uses one ACP sign-in action and only shows CLI instructions when no method is advertised", async () => {
    const status = vi.fn().mockResolvedValue(authRequired());
    const authenticate = vi.fn().mockResolvedValue(cliLoginRequired());

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={vi.fn()}
        authenticate={authenticate}
        cancelAuthenticate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.signIn));

    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Instructions" });
    expect(installAdapter).not.toHaveBeenCalled();
  });

  it("ACP sign-in transitions to READY only when the command confirms it", async () => {
    const status = vi.fn().mockResolvedValue(authRequired());
    const authenticate = vi.fn().mockResolvedValue(ready());

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={vi.fn()}
        authenticate={authenticate}
        cancelAuthenticate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.signIn));

    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    await screen.findByText(CARD_STATUS.ready);
  });

  it("cancel leaves sign-in usable and ignores the abandoned result", async () => {
    let finish!: (value: AnySetupView) => void;
    const authenticate = vi.fn().mockReturnValue(
      new Promise<AnySetupView>((resolve) => {
        finish = resolve;
      }),
    );
    const cancelAuthenticate = vi.fn().mockResolvedValue(undefined);

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={vi.fn().mockResolvedValue(authRequired())}
        verify={vi.fn()}
        authenticate={authenticate}
        cancelAuthenticate={cancelAuthenticate}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.signIn));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelAuthenticate).toHaveBeenCalledTimes(1));
    finish(ready());

    await waitFor(() => expect(screen.queryByText(CARD_STATUS.ready)).toBeNull());
    fireEvent.click(screen.getByText(CARD_STATUS.signIn));
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("requires a distinct confirmation before replacing an outdated adapter", async () => {
    adapterInstallPlan.mockResolvedValue({
      package: "@agentclientprotocol/codex-acp",
      command: "npm install @agentclientprotocol/codex-acp",
      adapter_path: "/bin/codex-acp",
    });

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={vi.fn().mockResolvedValue(adapterOutdated())}
        verify={vi.fn()}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.setUp));
    expect(await screen.findByText(/Replace outdated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(installAdapter).not.toHaveBeenCalled();
  });

  it("offers a retry after a genuine crash, distinct from the CLI instruction state", async () => {
    const status = vi.fn().mockResolvedValue(crashed("spawn failed"));
    const verify = vi.fn().mockResolvedValue(crashed("spawn failed"));

    renderWithTooltips(
      <CodingAgentSetup
        agent={CODEX_AGENT}
        logo="⬡"
        settings={{}}
        status={status}
        verify={verify}
        authenticate={vi.fn()}
        cancelAuthenticate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText(CARD_STATUS.retry));
    await screen.findByText(/spawn failed/);
    expect(screen.queryByText(`${CODEX_AGENT.displayName} isn't signed in`)).toBeNull();

    const retries = await screen.findAllByRole("button", { name: "Retry" });
    fireEvent.click(retries.at(-1)!);
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
  });
});

describe("narrow breakpoint", () => {
  it("snapshots both cards at the narrow breakpoint", () => {
    const { container } = renderWithTooltips(
      <div style={{ width: 320 }}>
        <CodingAgentCard
          agent={CODEX_AGENT}
          logo="⬡"
          status={{ primaryAction: "set-up", state: "adapter-missing" }}
          onOpenSetup={() => {}}
        />
        <CodingAgentCard
          agent={CLAUDE_AGENT}
          logo="✳"
          status={{ primaryAction: "none", state: "ready" }}
          onOpenSetup={() => {}}
        />
      </div>,
    );

    expect(container.innerHTML).toMatchSnapshot();
  });
});
