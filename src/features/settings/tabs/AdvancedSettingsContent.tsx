import { useCallback, useEffect, useState } from "react";
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
import { listen } from "@tauri-apps/api/event";

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

  // The Chromium runtime is a ~140MB download rather than part of the app, so
  // enabling it is an install, not just a preference. Nothing is decided at
  // boot any more, so this no longer restarts the app. The preference itself
  // is just the persisted store field — the backend only knows whether a pack
  // is installed.
  const [packStatus, setPackStatus] = useState<native.ViewportPackStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!SUPPORTS_CHROMIUM_BROWSER) return;
    void native.viewportPackStatus().then(setPackStatus).catch(() => undefined);
  }, []);

  const handleChromiumToggle = useCallback(
    (checked: boolean) => {
      if (!checked || packStatus?.installed) {
        actions.updateGeneral({ experimentalChromiumBrowser: checked });
        return;
      }

      useConfirmStore.getState().actions.request({
        title: "Download the Chromium browser runtime?",
        description:
          "The browser needs a one-time download of about 140MB. It is kept out of the app so everyone else does not pay for it.",
        confirmLabel: "Download",
        onConfirm: () => {
          setInstallProgress(0);
          // Subscribed for exactly the life of the install, rather than via an
          // effect keyed on the progress state the listener itself writes.
          const unlisten = listen<{ downloadedBytes: number; totalBytes: number | null }>(
            "viewport-pack-progress",
            (event) => {
              const { downloadedBytes, totalBytes } = event.payload;
              setInstallProgress(totalBytes ? downloadedBytes / totalBytes : 0);
            },
          );
          void native
            .viewportPackInstall()
            .then(() => native.viewportPackStatus())
            .then((status) => {
              setPackStatus(status);
              actions.updateGeneral({ experimentalChromiumBrowser: true });
              notify.success("Chromium browser ready", "The browser is available in the viewport.");
            })
            .catch((error) => {
              // Offline or a failed download must leave the switch off and the
              // iframe fallback working, not a half-enabled browser.
              actions.updateGeneral({ experimentalChromiumBrowser: false });
              notify.error("Browser runtime download failed", String(error));
            })
            .finally(() => {
              void unlisten.then((off) => off());
              setInstallProgress(null);
            });
        },
      });
    },
    [actions, notify, packStatus],
  );

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
                disabled={!experimentalFeatures || installProgress !== null}
                onCheckedChange={handleChromiumToggle}
              />
            }
          >
            <p className="text-sm text-muted-foreground">
              {installProgress !== null
                ? `Downloading the browser runtime… ${Math.round(installProgress * 100)}%`
                : packStatus && !packStatus.supported
                  ? "No browser runtime is published for this platform yet."
                  : packStatus?.installed
                    ? "Uses more memory and disk space than the iframe browser."
                    : "Needs a one-time ~140MB download. Uses more memory and disk space."}
            </p>
          </SettingRow>
        </SettingsSection>
      ) : null}
    </>
  );
}
