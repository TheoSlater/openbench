import type { ReactNode } from "react";

export type CommandPaletteCategory =
  | "conversation"
  | "action"
  | "setting"
  | "feature";

export type CommandPaletteIntentArgs = {
  "set-theme": { theme: "light" | "dark" | "system" };
  "delete-all-chats": {};
  "new-chat": {};
  "open-settings": {};
  "search-chats": { query: string };
  "rename-chat": { title: string };
  "archive-chat": {};
  "delete-chat": {};
};

export type CommandPaletteIntentCommand = keyof CommandPaletteIntentArgs;

export type CommandPaletteExecuteIntent = <T extends CommandPaletteIntentCommand>(
  args: CommandPaletteIntentArgs[T],
) => void | Promise<void>;

export interface CommandPaletteItem {
  id: string;
  title: string;
  description?: string;
  category: CommandPaletteCategory;
  keywords?: string[];
  icon?: ReactNode;
  /** Key caps, e.g. ["Ctrl", "K"]. */
  shortcut?: string[];
  execute: () => void;
  smartCommand?: {
    command: CommandPaletteIntentCommand;
    execute?: CommandPaletteExecuteIntent;
  };
}
