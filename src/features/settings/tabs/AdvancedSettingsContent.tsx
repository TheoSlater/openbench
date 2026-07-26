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
import { SUPPORTS_CHROMIUM_BROWSER } from "@/lib/utils/platform";
import { useConfirmStore } from "@/store/confirmStore";
import { useNotify } from "@/hooks/useNotify";
import * as native from "@/features/viewport/native";

export function AdvancedSettingsContent() {
  const {
    betaFeatures,
    experimentalChromiumBrowser,
    experimentalFeatures,
    memoryBeta,
    previewFeatures,
    terminalEmulator,
    actions,
  } = useSettingsStore(
    useShallow((state) => ({
      betaFeatures: state.general.betaFeatures,
      experimentalChromiumBrowser: state.general.experimentalChromiumBrowser,
      experimentalFeatures: state.general.experimentalFeatures,
      memoryBeta: state.general.memoryBeta,
      previewFeatures: state.general.previewFeatures,
      terminalEmulator: state.general.terminalEmulator,
      actions: state.actions,
    })),
  );
  const notify = useNotify();

  const handleExperimentalToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({ experimentalFeatures: checked });
  }, [actions]);

  const handleBetaToggle = useCallback((checked: boolean) => {
    actions.updateGeneral({
      betaFeatures: checked,
      ...(checked
        ? {}
        : { memoryBeta: false, terminalEmulator: "browser" as const }),
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
          description="Choose the offline browser shell or a native PTY with full system commands."
          action={
            <Select
              value={betaFeatures ? terminalEmulator : "browser"}
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
                  <SelectItem value="browser">Just Bash (Browser)</SelectItem>
                  <SelectItem value="native">Native PTY (xterm.js)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      {SUPPORTS_CHROMIUM_BROWSER ? (
        <SettingsSection title="Experimental features">
          <SettingRow
            title="Experimental Chromium browser"
            description="Use Chromium instead of the iframe browser for viewport pages."
            action={
              <Switch
                checked={experimentalFeatures && experimentalChromiumBrowser}
                disabled={!experimentalFeatures}
                onCheckedChange={handleChromiumToggle}
              />
            }
          >
            <p className="text-sm text-muted-foreground">
              Requires an app restart and uses more memory and disk space.
            </p>
          </SettingRow>
        </SettingsSection>
      ) : null}
    </>
  );
}
