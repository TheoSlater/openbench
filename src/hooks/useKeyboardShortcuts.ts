import { useEffect } from "react";
import type { SettingsTab } from "@/features/settings/SettingsModal";
import { requestComposerFocus } from "@/features/shortcuts/registry";

/**
 * One listener for every global shortcut. Previously each binding registered
 * its own `window` listener, which made ordering between them undefined and
 * left no obvious place to add the next one.
 */
export function useKeyboardShortcuts({
  onOpenSettings,
  setIsCommandPaletteOpen,
  onNewChat,
  onStopStreaming,
  onOpenShortcuts,
}: {
  onOpenSettings: (tab: SettingsTab) => void;
  setIsCommandPaletteOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onNewChat: () => void;
  onStopStreaming: () => void;
  onOpenShortcuts: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Escape is the only unmodified binding, so it is the only one that has
      // to yield: to an open dialog, menu or combobox, which close on Escape
      // themselves.
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        if (
          document.querySelector("[role='dialog'],[role='menu'],[role='listbox']")
        ) {
          return;
        }
        onStopStreaming();
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.repeat) return;

      switch (event.key.toLowerCase()) {
        case "k":
          event.preventDefault();
          setIsCommandPaletteOpen((open) => !open);
          return;
        case ",":
          event.preventDefault();
          onOpenSettings("general");
          return;
        case "n":
          event.preventDefault();
          onNewChat();
          requestComposerFocus();
          return;
        case "l":
          event.preventDefault();
          requestComposerFocus();
          return;
        case "/":
          event.preventDefault();
          onOpenShortcuts();
          return;
        default:
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    onNewChat,
    onOpenSettings,
    onOpenShortcuts,
    onStopStreaming,
    setIsCommandPaletteOpen,
  ]);
}
