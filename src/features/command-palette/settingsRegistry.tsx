import {
  Bell,
  Cpu,
  Info,
  Languages,
  Mic,
  Monitor,
  Palette,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  CircleUserRound,
  Zap,
} from "lucide-react";
import React from "react";
import { useShallow } from "zustand/react/shallow";
import type { SettingsTab } from "@/features/settings/SettingsModal";
import { useNotificationStore } from "@/store/notificationStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useThemeStore } from "@/store/themeStore";
import { getNextThemeMode } from "@/lib/theme";
import type { CommandPaletteItem } from "./types";

export type SettingsCommandContext = {
  openSettings: (tab: SettingsTab) => void;
  openAdvancedSettings: () => void;
};

type SettingsEntry = {
  id: string;
  title: string;
  description?: string;
  tab: SettingsTab;
  keywords?: string[];
  icon: React.ElementType;
  getStateLabel?: () => string;
  execute?: (context: SettingsCommandContext) => void;
};

export const settingsRegistry: SettingsEntry[] = [
  {
    id: "settings-general",
    title: "General",
    description: "Theme, language, notifications, and prompt defaults",
    tab: "general",
    keywords: ["settings", "preferences", "theme", "language"],
    icon: Palette,
  },
  {
    id: "settings-connections",
    title: "Connections",
    description: "Providers, models, and API connections",
    tab: "connections",
    keywords: ["providers", "models", "ollama", "openai"],
    icon: Cpu,
  },
  {
    id: "settings-profile",
    title: "Profile",
    description: "Display name, email, picture, and password",
    tab: "profile",
    keywords: ["account", "email", "password", "avatar"],
    icon: CircleUserRound,
  },
  {
    id: "settings-personalisation",
    title: "Personalisation",
    description: "Assistant preferences",
    tab: "personalisation",
    keywords: ["assistant", "prompt"],
    icon: User,
  },
  {
    id: "settings-speech",
    title: "Speech",
    description: "Dictation and text-to-speech settings",
    tab: "speech",
    keywords: ["voice", "dictation", "tts", "whisper"],
    icon: Mic,
  },
  {
    id: "settings-data-controls",
    title: "Data Controls",
    description: "Export, archive, or delete chat data",
    tab: "data-controls",
    keywords: ["export", "archive", "delete", "import", "backup"],
    icon: Shield,
  },
  {
    id: "settings-about",
    title: "About",
    description: "Version, updates, and release information",
    tab: "about",
    keywords: ["release", "version", "update"],
    icon: Info,
  },
  {
    id: "settings-advanced",
    title: "Advanced Settings",
    description: "Experimental, developer, diagnostics, and low-level configuration",
    tab: "general",
    keywords: ["advanced", "experiment", "experimental", "features", "developer"],
    icon: SlidersHorizontal,
    execute: ({ openAdvancedSettings }) => openAdvancedSettings(),
  },
  {
    id: "settings-theme",
    title: "Theme",
    description: "Switch appearance mode",
    tab: "general",
    keywords: ["appearance", "dark", "light", "system"],
    icon: Monitor,
    getStateLabel: () => {
      const mode = useThemeStore.getState().mode;
      return mode.charAt(0).toUpperCase() + mode.slice(1);
    },
    execute: () => {
      const { mode, setMode } = useThemeStore.getState();
      const next = getNextThemeMode(mode);
      setMode(next);
      useNotificationStore.getState().actions.add({
        type: "success",
        message: `Theme: ${next.charAt(0).toUpperCase() + next.slice(1)}`,
        duration: 2000,
      });
    },
  },
  {
    id: "settings-language",
    title: "Language",
    description: "Open language settings",
    tab: "general",
    keywords: ["locale", "english"],
    icon: Languages,
    getStateLabel: () => useSettingsStore.getState().general.language,
  },
  {
    id: "settings-notifications",
    title: "Notifications",
    description: "Toggle toast notifications",
    tab: "general",
    keywords: ["toast", "alerts"],
    icon: Bell,
    getStateLabel: () =>
      useSettingsStore.getState().general.notifications ? "On" : "Off",
    execute: () => {
      const state = useSettingsStore.getState();
      const next = !state.general.notifications;
      state.actions.updateGeneral({ notifications: next });
      useNotificationStore.getState().actions.add({
        type: next ? "success" : "info",
        message: next ? "Notifications on" : "Notifications off",
        duration: 2000,
      });
    },
  },
  {
    id: "settings-reduce-motion",
    title: "Reduce Motion",
    description: "Toggle reduced interface motion",
    tab: "general",
    keywords: ["animation", "performance", "accessibility"],
    icon: Zap,
    getStateLabel: () =>
      useSettingsStore.getState().performance.reduceMotion ? "On" : "Off",
    execute: () => {
      const state = useSettingsStore.getState();
      const next = !state.performance.reduceMotion;
      state.actions.updatePerformance({ reduceMotion: next });
      useNotificationStore.getState().actions.add({
        type: next ? "success" : "info",
        message: next ? "Reduce motion: On" : "Reduce motion: Off",
        duration: 2000,
      });
    },
  },
  {
    id: "settings-reduce-transparency",
    title: "Reduce Transparency",
    description: "Toggle solid interface surfaces",
    tab: "general",
    keywords: ["glass", "blur", "performance", "accessibility"],
    icon: Sparkles,
    getStateLabel: () =>
      useSettingsStore.getState().performance.reduceTransparency ? "On" : "Off",
    execute: () => {
      const state = useSettingsStore.getState();
      const next = !state.performance.reduceTransparency;
      state.actions.updatePerformance({ reduceTransparency: next });
      useNotificationStore.getState().actions.add({
        type: next ? "success" : "info",
        message: next ? "Reduce transparency: On" : "Reduce transparency: Off",
        duration: 2000,
      });
    },
  },
];

export function useSettingsCommands({
  openSettings,
  openAdvancedSettings,
}: SettingsCommandContext): CommandPaletteItem[] {
  const settingsState = useSettingsStore(
    useShallow((state) => ({
      notifications: state.general.notifications,
      language: state.general.language,
      reduceMotion: state.performance.reduceMotion,
      reduceTransparency: state.performance.reduceTransparency,
    })),
  );
  const themeMode = useThemeStore((state) => state.mode);

  return React.useMemo(
    () =>
      settingsRegistry.map((entry) => {
        const Icon = entry.icon;
        const stateLabel = entry.getStateLabel?.();
        return {
          id: entry.id,
          title: entry.title,
          description: stateLabel
            ? `${entry.description ?? "Setting"} - ${stateLabel}`
            : entry.description,
          category: "setting" as const,
          keywords: entry.keywords,
          icon: <Icon size={16} />,
          execute: entry.execute
            ? () => entry.execute?.({ openSettings, openAdvancedSettings })
            : () => openSettings(entry.tab),
        };
      }),
    [
      openAdvancedSettings,
      openSettings,
      settingsState.language,
      settingsState.notifications,
      settingsState.reduceMotion,
      settingsState.reduceTransparency,
      themeMode,
    ],
  );
}
