import {
  Bell,
  Brain,
  Brush,
  CircleUserRound,
  Cpu,
  Info,
  MessageSquareText,
  Mic,
  Smartphone,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export const ADVANCED_SETTINGS_VIEW_ID = "advanced-settings";

export type SettingsTabId =
  | "general"
  | "interface"
  | "providers"
  | "mobile"
  | "chat"
  | "voice"
  | "memory"
  | "personalization"
  | "data-controls"
  | "about";

export type LegacySettingsTab =
  | "connections"
  | "profile"
  | "personalisation"
  | "speech"
  | "audio"
  | "advanced";

export type SettingsTab = SettingsTabId | LegacySettingsTab;

export type SettingsTabDefinition = {
  id: SettingsTabId;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
};

export type AdvancedSettingsNavItem = {
  id: "advanced";
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  viewId: typeof ADVANCED_SETTINGS_VIEW_ID;
};

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  {
    id: "general",
    label: "General",
    description: "Language and notification defaults.",
    icon: Bell,
    keywords: ["settings", "preferences", "language", "notifications", "toast"],
  },
  {
    id: "interface",
    label: "Interface",
    description: "Theme, motion, transparency, app scale, and empty-state display.",
    icon: Brush,
    keywords: ["appearance", "theme", "dark", "light", "motion", "transparency", "zoom", "scale"],
  },
  {
    id: "providers",
    label: "Providers",
    description: "Ollama, OpenAI-compatible providers, and web search.",
    icon: Cpu,
    keywords: ["connections", "providers", "models", "ollama", "openai", "web", "search", "api"],
  },
  {
    id: "mobile",
    label: "Mobile",
    description: "Pair iOS and Android apps on the same Wi-Fi.",
    icon: Smartphone,
    keywords: ["mobile", "phone", "ios", "android", "wifi", "wi-fi", "pair", "qr"],
  },
  {
    id: "chat",
    label: "Chat",
    description: "Prompt preset and custom system prompt.",
    icon: MessageSquareText,
    keywords: ["composer", "prompt", "assistant", "system", "personalisation", "personalization"],
  },
  {
    id: "voice",
    label: "Voice",
    description: "AI voice, speech synthesis, dictation, and Whisper models.",
    icon: Mic,
    keywords: ["speech", "voice", "tts", "dictation", "whisper", "microphone"],
  },
  {
    id: "memory",
    label: "Memory",
    description: "Memory beta settings and stored memories.",
    icon: Brain,
    keywords: ["memory", "remember", "recall", "context", "beta"],
  },
  {
    id: "personalization",
    label: "Personalization",
    description: "Profile, account identity, avatar, and password.",
    icon: CircleUserRound,
    keywords: ["profile", "account", "email", "avatar", "password", "identity"],
  },
  {
    id: "data-controls",
    label: "Data Controls",
    description: "Export, archive, and delete chat data.",
    icon: Shield,
    keywords: ["data", "export", "archive", "delete", "backup", "privacy"],
  },
  {
    id: "about",
    label: "About",
    description: "App version and project information.",
    icon: Info,
    keywords: ["version", "release", "github", "polyui"],
  },
];

export const ADVANCED_SETTINGS_ITEM: AdvancedSettingsNavItem = {
  id: "advanced",
  label: "Advanced",
  description: "Experimental, developer, diagnostics, and low-level configuration.",
  icon: SlidersHorizontal,
  keywords: ["advanced", "developer", "experimental", "diagnostics", "sql"],
  viewId: ADVANCED_SETTINGS_VIEW_ID,
};

const tabAliases: Partial<Record<SettingsTab, SettingsTabId>> = {
  connections: "providers",
  profile: "personalization",
  personalisation: "chat",
  speech: "voice",
  audio: "voice",
  advanced: "general",
};

export function resolveSettingsTab(tab?: SettingsTab): SettingsTabId {
  if (!tab) return "general";
  if (tabAliases[tab]) return tabAliases[tab];
  return SETTINGS_TABS.find((item) => item.id === tab)?.id ?? "general";
}

function searchableText(tab: Pick<SettingsTabDefinition, "label" | "description" | "keywords">) {
  return `${tab.label} ${tab.description} ${tab.keywords.join(" ")}`.toLowerCase();
}

export function searchMatchesTab(tab: SettingsTabDefinition, query: string) {
  const normalized = query.trim().toLowerCase();
  return !normalized || searchableText(tab).includes(normalized);
}

export function filterSettingsTabs(query: string) {
  return SETTINGS_TABS.filter((tab) => searchMatchesTab(tab, query));
}
