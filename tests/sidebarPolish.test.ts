import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("sidebar polish", () => {
  it("integrates desktop sidebar branding into the titlebar", () => {
    const brand = read("src/features/sidebar/components/SidebarBrand.tsx");
    const sidebar = read("src/components/app-sidebar.tsx");
    const controls = read("src/components/WindowControls.tsx");
    const titlebar = read("src/components/Layout/WindowTitleBar.tsx");
    const titlebarBrand = read("src/components/PolyUiBrand.tsx");

    expect(titlebar).toContain("<PolyUiBrand");
    expect(titlebar).toContain(
      'paddingLeft: IS_MAC ? "var(--macos-titlebar-leading-inset)" : 8',
    );
    expect(titlebarBrand).toContain("px-3");
    expect(titlebarBrand).toContain("font-medium");
    expect(titlebarBrand).not.toContain("font-bold");
    expect(brand).not.toContain("transition-[width]");
    expect(sidebar).toContain("IS_MAC || USE_CUSTOM_WINDOW_CONTROLS");
    expect(controls).toContain("SIDEBAR_TOGGLE_EVENT");
    expect(controls).toContain('title="Toggle sidebar"');
    expect(controls).toContain('aria-hidden="true"');
  });

  it("does not let the initial html canvas hide native macOS material", () => {
    const index = read("index.html");
    const styles = read("src/App.css");
    const chatPanel = read("src/components/Layout/ChatPanel.tsx");
    const workspace = read("src/features/chat/components/ChatWorkspace.tsx");

    expect(index).toContain("const isMac");
    expect(index).toContain("'transparent'");
    expect(styles).toContain(
      "background: var(--macos-webview-background) !important",
    );
    expect(styles).toContain(
      '[data-slot="sidebar-inset"] > [data-chat-panel]',
    );
    expect(chatPanel).toContain("rounded-tl-(--sidebar-panel-radius)");
    expect(workspace).toContain("data-chat-workspace");
    expect(styles).toContain("--macos-chat-background");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain('html[data-platform="macos"]:not(.dark)');
    expect(styles).toContain("--sidebar-foreground: oklch(1 0 0 / 0.96)");
    expect(styles).toContain("--macos-sidebar-selected: color-mix(in oklch, black 22%, transparent)");
    expect(styles).toContain("border-width: 1px");
  });

  it("does not leave collapsed controls in the keyboard flow", () => {
    const brand = read("src/features/sidebar/components/SidebarBrand.tsx");
    const folders = read("src/features/sidebar/components/FoldersSection.tsx");
    const titlebar = read("src/components/Layout/WindowTitleBar.tsx");

    expect(brand).toContain("<PolyUiBrand");
    expect(brand).toContain("hidden={isCollapsed}");
    expect(titlebar).not.toContain("isCollapsed");
    expect(folders).toContain("hidden={isCollapsed}");
  });

  it("removes redundant empty and recent labels", () => {
    const folders = read("src/features/sidebar/components/FoldersSection.tsx");
    const conversations = read(
      "src/features/sidebar/components/ConversationList.tsx",
    );

    expect(folders).not.toContain("No folders");
    expect(conversations).not.toContain('label="Recents"');
  });

  it("keeps primary actions compact and discoverable", () => {
    const nav = read("src/components/nav-main.tsx");
    const profile = read("src/features/profile/ProfileMenu.tsx");

    // The shortcut hint must come from the Kbd component and the shortcut
    // registry, not a hand-rolled <kbd> with a hardcoded key label.
    expect(nav).toContain("<Kbd");
    expect(nav).toContain('shortcutKeys("search")');
    expect(nav).not.toContain("⌘");
    expect(profile).toContain("Local profile");
    expect(profile).not.toContain("Sign in");
  });
});
