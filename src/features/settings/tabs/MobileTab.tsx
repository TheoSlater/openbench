import { useEffect, useState } from "react";
import { Copy, RefreshCw, Square } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Stack } from "@/components/ui/Stack";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/Typography";
import { useSettingsStore } from "@/store/settingsStore";
import { SettingRow, SettingsSection } from "../SettingsShell";
import {
  relayPairingPayload,
  type MobileDefaultModel,
  useMobileConnectionStatus,
} from "@/lib/mobile/relay-bridge";
import { readDefaultRuntime } from "@/lib/runtime/legacy-default-model";

type MobilePairingInfo = {
  url: string;
  httpBaseUrl: string;
  host: string;
  port: number;
  token: string;
};

function pairingUrl(url: string, defaultModel?: MobileDefaultModel) {
  if (!defaultModel) return url;
  const value = new URL(url);
  value.searchParams.set("connectionId", defaultModel.connectionId);
  value.searchParams.set("model", defaultModel.name);
  return value.toString();
}

export function MobileTab() {
  const [pairing, setPairing] = useState<MobilePairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const relayUrl = import.meta.env.VITE_POLY_RELAY_URL as string | undefined;
  const { experimentalFeatures, mobileWebAccess, actions } = useSettingsStore(
    useShallow((state) => ({
      experimentalFeatures: state.general.experimentalFeatures,
      mobileWebAccess: state.general.mobileWebAccess,
      actions: state.actions,
    })),
  );
  const canUseMobileWeb = experimentalFeatures && mobileWebAccess;
  const deviceConnected = useMobileConnectionStatus((state) => state.connected);
  const runtime = readDefaultRuntime();
  const defaultModel = runtime?.kind === "chat-model"
    ? { connectionId: runtime.connection_id, name: runtime.model_id }
    : undefined;
  const pairedUrl = pairing ? pairingUrl(pairing.url, defaultModel) : "";

  useEffect(() => {
    let cancelled = false;
    void invoke<MobilePairingInfo | null>("mobile_pairing_status")
      .then((info) => {
        if (!cancelled) setPairing(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (canUseMobileWeb || !pairing) return;
    void invoke("mobile_pairing_stop")
      .then(() => setPairing(null))
      .catch(() => undefined);
  }, [canUseMobileWeb, pairing]);

  async function startPairing() {
    if (!canUseMobileWeb) {
      setMessage("Enable Experimental features and Mobile web access first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setPairing(await invoke<MobilePairingInfo>("mobile_pairing_start"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopPairing() {
    setBusy(true);
    setMessage(null);
    try {
      await invoke("mobile_pairing_stop");
      setPairing(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairedUrl);
      setMessage("Pairing URL copied.");
    } catch {
      setMessage("Copy failed. Select the pairing URL and copy it manually.");
    }
  }

  return (
    <SettingsSection
      title="Mobile Pairing"
      description="Connect PolyUI mobile over the same Wi-Fi or a configured relay."
    >
      {experimentalFeatures ? (
        <SettingRow
          title="Mobile web access"
          description="Allow phones to open the browser client."
          action={
            <Switch
              checked={mobileWebAccess}
              onCheckedChange={(checked) => actions.updateGeneral({ mobileWebAccess: checked })}
              aria-label="Toggle mobile web access"
            />
          }
        />
      ) : (
        <SettingRow
          title="Experimental features required"
          description="Turn on Experimental features in Advanced Settings to use mobile web access."
        />
      )}
      {canUseMobileWeb ? (
        <SettingRow
          title={pairing ? (deviceConnected ? "Device connected" : "Waiting for device") : "Start pairing"}
          description={
            pairing
              ? `Listening at ${pairing.httpBaseUrl}. ${relayUrl ? "Relay allows remote networks." : "Same Wi-Fi required."}`
              : "Creates a temporary QR code."
          }
          action={
            pairing ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={stopPairing} startIcon={<Square />}>
                Stop
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={busy} onClick={startPairing} startIcon={<RefreshCw />}>
                Start Pairing
              </Button>
            )
          }
        >
          {pairing ? (
            <Stack spacing={3}>
              <div className="w-fit rounded-xl border border-border/60 bg-white p-3 dark:bg-white">
                <QRCodeSVG
                  value={relayUrl ? relayPairingPayload(pairing, relayUrl, defaultModel) : pairedUrl}
                  size={184}
                  marginSize={1}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {relayUrl ? "Remote relay pairing enabled." : pairing.url}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyUrl} startIcon={<Copy />}>
                  Copy
                </Button>
              </div>
            </Stack>
          ) : null}
          {message ? <Typography className="text-sm text-muted-foreground">{message}</Typography> : null}
        </SettingRow>
      ) : null}
      <SettingRow
        title="Connection limits"
        description="Remote relay or same Wi-Fi. Firewall, VPN, or a stopped desktop can block connection."
      />
    </SettingsSection>
  );
}
