// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getNextThemeMode } from "@/lib/theme";
import { useCommandPaletteItems } from "@/hooks/useCommandPaletteItems";

describe("theme commands", () => {
  it.each([
    ["system", "dark"],
    ["dark", "light"],
    ["light", "system"],
  ] as const)("cycles from %s to %s", (current, expected) => {
    expect(getNextThemeMode(current)).toBe(expected);
  });

  it("cycles the theme when the Set Theme palette action is selected", () => {
    const onSetTheme = vi.fn();
    const { result } = renderHook(() =>
      useCommandPaletteItems({
        conversations: [],
        activeConversationId: null,
        features: [],
        onNewChat: vi.fn(),
        onDeleteAllConversations: vi.fn(),
        onOpenSettings: vi.fn(),
        onRenameCurrentChat: vi.fn(),
        onSetTheme,
        onSelectConversation: vi.fn(),
        onOpenArchived: vi.fn(),
        onOpenShortcuts: vi.fn(),
        notify: { success: vi.fn(), error: vi.fn() },
        registeredActions: [],
        settingsCommands: [],
      }),
    );

    act(() => result.current.find((item) => item.id === "action:set-theme")?.execute());

    expect(onSetTheme).toHaveBeenCalledWith({});
  });
});
