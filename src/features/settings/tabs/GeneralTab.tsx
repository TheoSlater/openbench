import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useShallow } from "zustand/react/shallow";
import { SettingsSection, SettingRow } from "../SettingsShell";
import { useSettingsStore } from "@/store/settingsStore";

export function GeneralTab() {
  const { general, actions } = useSettingsStore(
    useShallow((state) => ({
      general: state.general,
      actions: state.actions,
    })),
  );

  return (
    <SettingsSection title="General" description="Default app preferences.">
      <SettingRow
        title="Language"
        description="UI language preference."
        action={
          <Select
            value={general.language}
            onValueChange={(value) => {
              if (value) actions.updateGeneral({ language: value });
            }}
          >
            <SelectTrigger size="sm" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="en">English</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />
      <SettingRow
        title="Notifications"
        description="Show toast notifications for events."
        action={
          <Switch
            checked={general.notifications}
            onCheckedChange={(checked) => actions.updateGeneral({ notifications: checked })}
          />
        }
      />
    </SettingsSection>
  );
}
