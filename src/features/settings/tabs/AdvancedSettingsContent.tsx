import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Switch } from "@/components/ui/switch";
import { SettingsSection, SettingRow } from "../SettingsShell";
import { useSettingsStore } from "@/store/settingsStore";
import {
  disableMemoryForOwner,
  memoryGetSettings,
  memoryUpdateSettings,
} from "@/features/memory/memoryClient";
import { getCurrentProviderAccountId } from "@/features/providers";
import { devLog } from "@/features/debug-overlay/devLog";

export function AdvancedSettingsContent() {
  const {
    betaFeatures,
    experimentalFeatures,
    memoryBeta,
    previewFeatures,
    actions,
  } = useSettingsStore(
    useShallow((state) => ({
      betaFeatures: state.general.betaFeatures,
      experimentalFeatures: state.general.experimentalFeatures,
      memoryBeta: state.general.memoryBeta,
      previewFeatures: state.general.previewFeatures,
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
        devLog("warn", "memory", "disableMemoryForOwner failed", err),
      );
    }
  }, [actions]);

  const handleMemoryToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({ memoryBeta: checked });
    const ownerId = getCurrentProviderAccountId();
    devLog("info", "memory", "Memory toggle changed", { checked, ownerId });
    if (!checked) {
      void disableMemoryForOwner(ownerId).catch((err) =>
        devLog("warn", "memory", "disableMemoryForOwner failed", err),
      );
      return;
    }
    void memoryGetSettings(ownerId)
      .then((existing) => {
        devLog("info", "memory", "Existing settings loaded", existing);
        return memoryUpdateSettings({
          ...existing,
          enabled: true,
          automaticExtraction: true,
          ownerId,
        });
      })
      .then((saved) => {
        devLog("info", "memory", "Settings saved", saved);
      })
      .catch((err) => {
        devLog("error", "memory", "Failed to update settings", err);
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
      </SettingsSection>

    </>
  );
}
