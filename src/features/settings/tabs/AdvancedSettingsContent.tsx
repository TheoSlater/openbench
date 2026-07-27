import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSection, SettingRow } from "../SettingsShell";
import {
  useSettingsStore,
  type TerminalEmulator,
} from "@/store/settingsStore";
import {
  disableMemoryForOwner,
  memoryGetSettings,
  memoryUpdateSettings,
} from "@/features/memory/memoryClient";
import { getCurrentProviderAccountId } from "@/features/providers";

export function AdvancedSettingsContent() {
  const {
    betaFeatures,
    experimentalFeatures,
    memoryBeta,
    previewFeatures,
    terminalEmulator,
    actions,
  } = useSettingsStore(
    useShallow((state) => ({
      betaFeatures: state.general.betaFeatures,
      experimentalFeatures: state.general.experimentalFeatures,
      memoryBeta: state.general.memoryBeta,
      previewFeatures: state.general.previewFeatures,
      terminalEmulator: state.general.terminalEmulator,
      actions: state.actions,
    })),
  );

  const handleExperimentalToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({ experimentalFeatures: checked });
  }, [actions]);

  const handleBetaToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({
      betaFeatures: checked,
      ...(!checked && { memoryBeta: false }),
    });
    if (!checked) {
      void disableMemoryForOwner(getCurrentProviderAccountId()).catch((err) =>
        console.warn("[Memory] disableMemoryForOwner failed", err),
      );
    }
  }, [actions]);

  const handleMemoryToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({ memoryBeta: checked });
    const ownerId = getCurrentProviderAccountId();
    console.info(`[Memory] toggle changed to ${checked}, ownerId="${ownerId}"`);
    if (!checked) {
      void disableMemoryForOwner(ownerId).catch((err) =>
        console.warn("[Memory] disableMemoryForOwner failed", err),
      );
      return;
    }
    void memoryGetSettings(ownerId)
      .then((existing) => {
        console.info("[Memory] existing settings from backend", existing);
        return memoryUpdateSettings({
          ...existing,
          enabled: true,
          automaticExtraction: true,
          ownerId,
        });
      })
      .then((saved) => {
        console.info("[Memory] settings saved to backend", saved);
      })
      .catch((err) => {
        console.error("[Memory] failed to update settings", err);
      });
  }, [actions]);

  return (
    <>
      <SettingsSection
        title="Feature access"
        description="Choose which pre-release feature tiers are available."
      >
        <SettingRow
          title="Enable experimental features"
          description="Unlocks in-development features."
          action={
            <Switch
              checked={experimentalFeatures}
              onCheckedChange={handleExperimentalToggle}
            />
          }
        />
        <SettingRow
          title="Enable beta features"
          description="Unlocks testable features that may still change."
          action={
            <Switch
              checked={betaFeatures}
              onCheckedChange={handleBetaToggle}
            />
          }
        />
        <SettingRow
          title="Enable preview features"
          description="Unlocks early product previews. No preview features are available yet."
          action={
            <Switch
              checked={previewFeatures}
              onCheckedChange={(checked) =>
                actions.updateGeneral({ previewFeatures: checked })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Beta features">
        <SettingRow
          title="Memory (Beta)"
          description="Remember information across chats. Poly extracts and recalls relevant context automatically."
          action={
            <Switch
              checked={betaFeatures && memoryBeta}
              disabled={!betaFeatures}
              onCheckedChange={handleMemoryToggle}
            />
          }
        >
          <p className="text-sm text-muted-foreground">
            A Memory tab appears in Settings when enabled.
          </p>
        </SettingRow>
        <SettingRow
          title="Terminal (Beta)"
          description="Choose a terminal renderer for the native PTY and full system commands."
          action={
            <Select
              value={terminalEmulator === "xterm" ? "xterm" : "native"}
              onValueChange={(value) =>
                actions.updateGeneral({
                  terminalEmulator: value as TerminalEmulator,
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="min-w-48"
                disabled={!betaFeatures}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="native">Native PTY (Ghostty)</SelectItem>
                  <SelectItem value="xterm">Native PTY (xterm.js)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

    </>
  );
}
