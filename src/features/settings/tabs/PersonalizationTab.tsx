import { ProfileTab } from "./ProfileTab";

export function PersonalizationTab({ onOpenOnboarding }: { onOpenOnboarding?: () => void }) {
  return <ProfileTab onOpenOnboarding={onOpenOnboarding} />;
}
