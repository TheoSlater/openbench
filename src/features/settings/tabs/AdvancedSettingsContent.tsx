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
import { IS_LINUX } from "@/lib/utils/platform";
import { useConfirmStore } from "@/store/confirmStore";
import { useNotify } from "@/hooks/useNotify";
import * as native from "@/features/viewport/native";

export function AdvancedSettingsContent() {
  const { experimentalChromiumBrowser, experimentalFeatures, memoryBeta, actions } = useSettingsStore(
    useShallow((state) => ({
      experimentalChromiumBrowser: state.general.experimentalChromiumBrowser,
      experimentalFeatures: state.general.experimentalFeatures,
      memoryBeta: state.general.memoryBeta,
      actions: state.actions,
    })),
  );
  const notify = useNotify();

  const handleExperimentalToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({ experimentalFeatures: checked });
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

  const handleChromiumToggle = useCallback((checked: boolean) => {
    useConfirmStore.getState().actions.request({
      title: checked ? "Use experimental Chromium browser?" : "Disable experimental Chromium browser?",
      description: checked
        ? "Chromium uses more memory and disk space. Poly will restart to enable it."
        : "Poly will restart and return to the lighter iframe browser.",
      confirmLabel: "Restart",
      onConfirm: () => {
        void native.cefViewportSetEnabled(checked)
          .then(() => {
            return native.restartApp();
          })
          .catch((error) => notify.error("Browser setting failed", String(error)));
      },
    });
  }, [notify]);

  return (
    <SettingsSection
      title="Experimental"
      description="Upcoming features before they are stable."
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
        title="Memory (Beta)"
        description="Remember information across chats. Poly extracts and recalls relevant context automatically."
        action={
          <Switch
            checked={memoryBeta}
            onCheckedChange={handleMemoryToggle}
          />
        }
      >
        <p className="text-sm text-muted-foreground">
          A Memory tab appears in Settings when enabled.
        </p>
      </SettingRow>
      {IS_LINUX ? (
        <SettingRow
          title="Experimental Chromium browser"
          description="Use Chromium instead of the iframe browser for viewport pages."
          action={
            <Switch
              checked={experimentalChromiumBrowser}
              onCheckedChange={handleChromiumToggle}
            />
          }
        >
          <p className="text-sm text-muted-foreground">
            Requires an app restart and uses more memory and disk space.
          </p>
        </SettingRow>
      ) : null}
    </SettingsSection>
  );
}
