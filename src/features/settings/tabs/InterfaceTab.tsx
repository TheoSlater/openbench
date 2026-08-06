import { useShallow } from "zustand/react/shallow";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingRow } from "../SettingsShell";
import { useSettingsStore } from "@/store/settingsStore";
import { useThemeStore, type ThemeMode } from "@/store/themeStore";

export function InterfaceTab() {
  const { mode, setMode } = useThemeStore(
    useShallow((state) => ({
      mode: state.mode,
      setMode: state.setMode,
    })),
  );
  const { showModelInEmptyState, performance, actions } = useSettingsStore(
    useShallow((state) => ({
      showModelInEmptyState: state.general.showModelInEmptyState,
      performance: state.performance,
      actions: state.actions,
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Appearance"
        description="Control how Poly UI looks in this desktop window."
      >
        <SettingRow
          title="Theme"
          description="Choose light, dark, or system appearance."
          action={
            <Select value={mode} onValueChange={(value) => setMode(value as ThemeMode)}>
              <SelectTrigger size="sm" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="Show model in empty state"
          description="Display the active model name instead of the greeting when no messages exist."
          action={
            <Switch
              checked={showModelInEmptyState}
              onCheckedChange={(checked) => actions.updateGeneral({ showModelInEmptyState: checked })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Performance"
        description="Tune motion and surface effects for this device."
      >
        <SettingRow
          title="Reduce motion"
          description="Starts from your OS preference. Override it here anytime."
          action={
            <Switch
              checked={performance.reduceMotion}
              onCheckedChange={(checked) => actions.updatePerformance({ reduceMotion: checked })}
            />
          }
        />
        <SettingRow
          title="Reduce transparency"
          description="Prefer solid surfaces over transparent window effects."
          action={
            <Switch
              checked={performance.reduceTransparency}
              onCheckedChange={(checked) => actions.updatePerformance({ reduceTransparency: checked })}
            />
          }
        />
        <SettingRow
          title="App scale"
          description={`${Math.round(performance.appZoom * 100)}%`}
        >
          <Slider
            value={performance.appZoom}
            min={0.5}
            max={2}
            step={0.1}
            onValueChange={(value) =>
              actions.updatePerformance({
                appZoom: value,
              })
            }
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
