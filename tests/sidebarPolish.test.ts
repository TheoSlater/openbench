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
    expect(titlebar).toContain("paddingLeft: IS_MAC ? 80 : 8");
    expect(titlebarBrand).toContain("px-3");
    expect(titlebarBrand).toContain("font-medium");
    expect(titlebarBrand).not.toContain("font-bold");
    expect(brand).not.toContain("transition-[width]");
    expect(sidebar).toContain("IS_MAC || USE_CUSTOM_WINDOW_CONTROLS");
    expect(controls).toContain("SIDEBAR_TOGGLE_EVENT");
    expect(controls).toContain('title="Toggle sidebar"');
    expect(controls).toContain('aria-hidden="true"');
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
    const guest = read("src/features/sidebar/components/GuestFooter.tsx");

    expect(nav).toContain("<kbd");
    expect(guest).toContain('aria-label="Sign in"');
    expect(guest).not.toContain('className="min-h-[30px] w-full');
  });
});
