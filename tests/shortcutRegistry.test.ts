import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  shortcutKeys,
} from "../src/features/shortcuts/registry";

describe("shortcut registry", () => {
  it("renders every shortcut in the dialog", () => {
    // ShortcutsDialog only iterates SHORTCUT_GROUPS, so a shortcut in a group
    // that isn't listed there would silently never be shown.
    for (const shortcut of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
    }
  });

  it("has unique ids so lookups are unambiguous", () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every shortcut at least one key cap", () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.keys.every((key) => key.length > 0)).toBe(true);
    }
  });

  it("resolves ids advertised elsewhere in the UI", () => {
    // Referenced by the command palette and the sidebar search row.
    for (const id of ["new-chat", "settings", "shortcuts", "search"]) {
      expect(shortcutKeys(id)).toBeDefined();
    }
    expect(shortcutKeys("nope")).toBeUndefined();
  });
});
