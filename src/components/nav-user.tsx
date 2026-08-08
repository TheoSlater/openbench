import { ProfileMenu } from "@/features/profile/ProfileMenu"
import type { SettingsTab } from "@/features/settings/SettingsModal"

interface NavUserProps {
  onOpenSettings: (tab?: SettingsTab) => void
}

export function NavUser({ onOpenSettings }: NavUserProps) {
  return <ProfileMenu onOpenSettings={onOpenSettings} />
}
