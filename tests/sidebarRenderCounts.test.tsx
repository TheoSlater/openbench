// @vitest-environment jsdom
//
// Phase 1 instrumentation for the sidebar performance work.
//
// Counts how many times each sidebar component's function body actually runs,
// under the four conditions in the brief: idle, streaming, typing, hover.
//
// Two things make the numbers trustworthy:
//   - vitest.config.ts runs babel-plugin-react-compiler, same as vite.config.ts,
//     so auto-memoization is in effect here exactly as it is in the app.
//   - The counter wraps memo components *inside* the memo object, so wrapping
//     does not itself defeat memoization and inflate the counts.
//
// This measures React render cascades only. It cannot measure WebKitGTK
// layout/compositing cost, which is the other half of the story.

import * as React from "react";
import { render, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom gaps. Note the ResizeObserver stub never fires: jsdom has no layout, so
// the virtualizer's measureElement feedback loop CANNOT reproduce here. That
// cost is real but has to be argued from the code, not from these numbers.
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}
// jsdom reports every element as 0x0, which makes the virtualizer decide no
// rows are visible and render none of them. Give elements a real box so the
// list actually populates and row renders can be counted.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get: () => 600,
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get: () => 260,
});
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => 600,
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 260,
});
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 260, bottom: 600, width: 260, height: 600, toJSON: () => {} } as DOMRect;
};

if (!(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const h = vi.hoisted(() => ({ counts: {} as Record<string, number> }));

/** Wrap a component so each render of its body increments a counter, without
 *  changing its memoization behaviour. */
const wrap = vi.hoisted(() => (name: string, Comp: any): any => {
  const memoTag = Symbol.for("react.memo");
  const bump = (fn: any) =>
    function Counted(props: any) {
      h.counts[name] = (h.counts[name] ?? 0) + 1;
      return fn(props);
    };
  // memo(fn) → keep the memo wrapper, count the inner render fn.
  if (Comp && typeof Comp === "object" && Comp.$$typeof === memoTag) {
    return { ...Comp, type: bump(Comp.type) };
  }
  return bump(Comp);
});

// --- Tauri surface the sidebar pulls in at import time -----------------------
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn(async () => ({ select: async () => [], execute: async () => {} })) },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async () => () => {},
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux", type: () => "linux" }));

// --- Components under measurement -------------------------------------------
vi.mock("@/features/chat/components/ConversationItem", async (orig) => {
  const m: any = await orig();
  return { ...m, ConversationItem: wrap("ConversationItem", m.ConversationItem) };
});
vi.mock("@/features/sidebar/components/ConversationList", async (orig) => {
  const m: any = await orig();
  return { ...m, ConversationList: wrap("ConversationList", m.ConversationList) };
});
vi.mock("@/features/sidebar/components/FoldersSection", async (orig) => {
  const m: any = await orig();
  return { ...m, FoldersSection: wrap("FoldersSection", m.FoldersSection) };
});
vi.mock("@/features/sidebar/components/SidebarBrand", async (orig) => {
  const m: any = await orig();
  return { ...m, SidebarBrand: wrap("SidebarBrand", m.SidebarBrand) };
});
vi.mock("@/components/nav-main", async (orig) => {
  const m: any = await orig();
  return { ...m, NavMain: wrap("NavMain", m.NavMain) };
});
vi.mock("@/components/nav-user", async (orig) => {
  const m: any = await orig();
  return { ...m, NavUser: wrap("NavUser", m.NavUser) };
});
// Counted, not queried: TooltipTrigger uses asChild, so its data-slot is
// overridden by the child's own and can't be found in the DOM.
vi.mock("@/components/ui/tooltip", async (orig) => {
  const m: any = await orig();
  return { ...m, Tooltip: wrap("RadixTooltip", m.Tooltip) };
});
vi.mock("@/components/ui/sidebar", async (orig) => {
  const m: any = await orig();
  return { ...m, SidebarMenuButton: wrap("SidebarMenuButton", m.SidebarMenuButton) };
});

import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SIDEBAR_TOGGLE_EVENT } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chatStore";
import type { Conversation } from "@/types/chat";

// Four conversations — the row count at which the user already sees lag.
const CONVERSATIONS: Conversation[] = [0, 1, 2, 3].map((i) => ({
  id: `c${i}`,
  title: `Conversation ${i}`,
  createdAt: new Date(Date.now() - i * 36e5).toISOString(),
  updatedAt: new Date(Date.now() - i * 36e5).toISOString(),
  isArchived: false,
})) as Conversation[];

function Harness() {
  return (
    <TooltipProvider>
    <SidebarProvider>
      <AppSidebar
        onOpenSettings={() => {}}
        onOpenCommandPalette={() => {}}
        onNewChat={() => {}}
        onSelectConversation={() => {}}
        onDeleteConversation={async () => {}}
        onRenameConversation={async () => {}}
        conversations={CONVERSATIONS}
        activeConversationId="c0"
      />
    </SidebarProvider>
    </TooltipProvider>
  );
}

const reset = () => Object.keys(h.counts).forEach((k) => delete h.counts[k]);
const snapshot = () => ({ ...h.counts });

/** jsdom has no rAF-driven layout; flush microtasks + timers between phases. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const table: Record<string, Record<string, number>> = {};

beforeEach(() => {
  useChatStore.setState({
    conversations: CONVERSATIONS,
    activeConversationId: "c0",
    conversationsLoading: false,
    streamingConversationId: null,
    streamingMessages: {},
    messages: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sidebar render counts", () => {
  it("mount — baseline census (also proves the counter is wired)", async () => {
    reset();
    const view = render(<Harness />);
    await settle();
    table.mount = snapshot();
    // If this is empty the vi.mock wrapping silently failed and every other
    // number in this file is meaningless.
    expect(h.counts.ConversationList ?? 0).toBeGreaterThan(0);
    expect(h.counts.ConversationItem ?? 0).toBeGreaterThan(0);
    view.unmount();
  });

  it("idle — nothing should re-render after mount", async () => {
    const view = render(<Harness />);
    await settle();
    reset();

    // Sit idle for a few frames.
    await settle();
    await settle();

    table.idle = snapshot();
    expect(Object.keys(h.counts)).toEqual([]);
    view.unmount();
  });

  it("streaming — 60 rAF-batched token flushes into the open chat", async () => {
    const view = render(<Harness />);
    await settle();

    // A stream begins: this is a real state change the sidebar reads.
    await act(async () => {
      useChatStore.setState({ streamingConversationId: "c0" });
    });
    reset();

    // 60 token batches, exactly as StreamAccumulator flushes them.
    await act(async () => {
      for (let i = 0; i < 60; i++) {
        useChatStore.getState().actions.patchStreamingMessages({
          m1: { content: "token ".repeat(i + 1), status: "streaming" },
        });
      }
    });
    await settle();

    table.streaming = snapshot();
    view.unmount();
  });

  it("typing — composer keystrokes bump unrelated chat state", async () => {
    const view = render(<Harness />);
    await settle();
    reset();

    // The composer is outside the sidebar; typing writes to chatStore
    // (draft/attachment state). The sidebar must not react.
    await act(async () => {
      for (let i = 0; i < 30; i++) {
        useChatStore.setState({ messages: [] });
      }
    });
    await settle();

    table.typing = snapshot();
    view.unmount();
  });

  it("hover — pointer crossing all four rows", async () => {
    const view = render(<Harness />);
    await settle();
    reset();

    const rows = view.container.querySelectorAll('[data-sidebar="menu-button"]');
    await act(async () => {
      rows.forEach((row) => {
        fireEvent.pointerEnter(row);
        fireEvent.mouseOver(row);
        fireEvent.mouseEnter(row);
        fireEvent.pointerLeave(row);
        fireEvent.mouseOut(row);
      });
    });
    await settle();

    table.hover = snapshot();
    table.__meta = { rows: rows.length };
    view.unmount();
  });

  it("mounts no Radix tooltips while the sidebar is expanded", async () => {
    reset();
    const view = render(<Harness />);
    await settle();

    // Expanded rows never show a tooltip. Mounting one per row anyway costs a
    // Radix open-state machine + Floating UI positioning on every hover, which
    // is what made hovering the list feel sluggish.
    expect(h.counts.RadixTooltip ?? 0).toBe(0);
    view.unmount();
  });

  it("drives collapsed row geometry from CSS, not React state", async () => {
    const view = render(<Harness />);
    await settle();

    const rowClasses = () =>
      [...view.container.querySelectorAll('[data-sidebar="menu-button"]')].map(
        (el) => el.parentElement?.className ?? "",
      );

    const before = rowClasses();
    expect(before.length).toBeGreaterThan(0);

    await act(async () => {
      window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT));
    });
    await settle();

    // The panel really did collapse...
    expect(
      view.container.querySelector('[data-slot="sidebar"]')?.getAttribute("data-collapsible"),
    ).toBe("icon");
    // ...but no row rewrote its own padding on the first frame. Collapsed
    // geometry now hangs off the ancestor's data attribute, so it eases with
    // the panel width instead of snapping ahead of it.
    expect(rowClasses()).toEqual(before);
    view.unmount();
  });

  it("prints the table", () => {
    const names = new Set<string>();
    for (const [k, v] of Object.entries(table)) {
      if (k !== "__meta") Object.keys(v).forEach((n) => names.add(n));
    }
    const conditions = ["mount", "idle", "streaming", "typing", "hover"];
    const rows = [...names].sort().map((n) => ({
      component: n,
      ...Object.fromEntries(conditions.map((c) => [c, table[c]?.[n] ?? 0])),
    }));
    // eslint-disable-next-line no-console
    console.log("\nrows rendered in list:", table.__meta?.rows);
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});
