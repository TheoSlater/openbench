import { Globe } from "lucide-react";
import React from "react";
import { useChatStore } from "@/store/chatStore";
import { useSettingsStore } from "@/store/settingsStore";

export type FeatureKind = "toggle" | "forced_toggle";

export interface FeatureDef {
  id: string;
  name: string;
  description?: string;
  kind: FeatureKind;
  icon: React.ElementType;
  useIsActive: () => boolean;
  getIsActive: () => boolean;
  toggle: () => void;
  getWarning?: () => string | undefined;
  experimental?: boolean;
  /** Show as its own button in the composer instead of inside the "..." menu. */
  pinned?: boolean;
  /** Shorter label for the pinned button; falls back to `name`. */
  shortName?: string;
}

export const featureRegistry: FeatureDef[] = [
  {
    id: "web_search",
    name: "Web search",
    kind: "forced_toggle",
    description: "Search the web for real-time information",
    icon: Globe,
    pinned: true,
    shortName: "Search",
    useIsActive: () =>
      useChatStore((state) => state.activeFeatureIds.includes("web_search")),
    getIsActive: () =>
      useChatStore.getState().activeFeatureIds.includes("web_search"),
    toggle: () => useChatStore.getState().actions.toggleFeature("web_search"),
  },
];

export function isFeatureAIActive(featureId: string): boolean {
  const feature = featureRegistry.find((item) => item.id === featureId);
  if (!feature) return false;
  return feature.getIsActive();
}

/**
 * Features a brand-new conversation starts with, from saved settings.
 * Settings hold the *default*; the live per-conversation state lives in
 * chatStore.activeFeatureIds.
 */
export function getDefaultFeatureIds(): string[] {
  const { general } = useSettingsStore.getState();
  return general.webSearchEnabled ? ["web_search"] : [];
}

export function useFeatures() {
  const activeFeatureIds = useChatStore((state) => state.activeFeatureIds);
  const experimentalEnabled = useSettingsStore((state) => state.general.experimentalFeatures);

  return featureRegistry
    .filter((feature) => !feature.experimental || experimentalEnabled)
    .map((feature) => ({
      ...feature,
      active: activeFeatureIds.includes(feature.id),
      warning: feature.getWarning?.(),
    }));
}
