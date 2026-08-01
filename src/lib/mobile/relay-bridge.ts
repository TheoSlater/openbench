import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { create } from "zustand";

import { useNotify } from "@/hooks/useNotify";
import { useSettingsStore } from "@/store/settingsStore";

import {
  createRelayKeyPair,
  decryptRelay,
  deriveRelayKey,
  encryptRelay,
  type RelayCiphertext,
  type RelayKeyPair,
} from "./relay-crypto";

type PairingInfo = {
  httpBaseUrl: string;
  host: string;
  token: string;
  deviceConnected?: boolean;
};

export type MobileDefaultModel = {
  connectionId: string;
  name: string;
};

type RemoteRequest = {
  type: "request";
  id: string;
  method: string;
  path: string;
  body?: string;
};

const keys = new Map<string, RelayKeyPair>();

type MobileConnectionState = { connected: boolean; hostName: string | null };

export const useMobileConnectionStatus = create<MobileConnectionState>(() => ({
  connected: false,
  hostName: null,
}));

function setMobileConnectionStatus(connected: boolean, hostName: string | null) {
  useMobileConnectionStatus.setState((state) => ({
    connected,
    hostName: hostName ?? state.hostName,
  }));
}

export function relayUrl(value: string) {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

export function relayPairingPayload(
  info: PairingInfo,
  relay: string,
  defaultModel?: MobileDefaultModel,
) {
  const key = keys.get(info.token) ?? createRelayKeyPair();
  keys.set(info.token, key);
  return JSON.stringify({
    version: 1,
    relayUrl: relay,
    hostId: info.token,
    hostName: info.host,
    pairingToken: info.token,
    hostPublicKey: key.publicKey,
    defaultModel,
  });
}

class RelayHostBridge {
  private socket: WebSocket | null = null;
  private sessionKey: string | null = null;
  private stopped = false;

  constructor(
    private readonly info: PairingInfo,
    private readonly relay: string,
    private readonly key: RelayKeyPair,
  ) {}

  start() {
    this.socket = new WebSocket(relayUrl(this.relay));
    this.socket.onopen = () => {
      this.socket?.send(
        JSON.stringify({
          type: "register",
          role: "host",
          hostId: this.info.token,
          pairingToken: this.info.token,
          publicKey: this.key.publicKey,
        }),
      );
    };
    this.socket.onmessage = (event) => this.handle(String(event.data));
    this.socket.onclose = () => {
      if (!this.stopped) setTimeout(() => this.start(), 1500);
    };
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private handle(raw: string) {
    const message = JSON.parse(raw) as
      | { type: "ready"; peerPublicKey: string }
      | { type: "frame"; payload: RelayCiphertext };
    if (message.type === "ready") {
      this.sessionKey = deriveRelayKey(this.key.secretKey, message.peerPublicKey);
      return;
    }
    if (message.type === "frame" && this.sessionKey) {
      void this.handleRequest(decryptRelay<RemoteRequest>(message.payload, this.sessionKey));
    }
  }

  private async handleRequest(request: RemoteRequest) {
    if (!this.socket || !this.sessionKey) return;
    try {
      const url = new URL(request.path, this.info.httpBaseUrl);
      url.searchParams.set("token", this.info.token);
      const response = await fetch(url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: request.body,
      });
      if (request.path.startsWith("/api/chat-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          this.send({ type: "stream", id: request.id, data: decoder.decode(next.value) });
        }
        this.send({ type: "stream-end", id: request.id });
        return;
      }
      this.send({
        type: "response",
        id: request.id,
        status: response.status,
        body: await response.text(),
      });
    } catch (error) {
      this.send({
        type: "response",
        id: request.id,
        status: 502,
        body: JSON.stringify({ ok: false, error: String(error) }),
      });
    }
  }

  private send(value: unknown) {
    if (!this.socket || !this.sessionKey) return;
    this.socket.send(
      JSON.stringify({ type: "frame", payload: encryptRelay(value, this.sessionKey) }),
    );
  }
}

export function useMobileRelayBridge() {
  const notify = useNotify();
  const notificationsEnabled = useSettingsStore((state) => state.general.notifications);
  useEffect(() => {
    const relay = import.meta.env.VITE_POLY_RELAY_URL as string | undefined;

    let bridge: RelayHostBridge | null = null;
    let stopped = false;
    let previousConnected: boolean | null = null;
    const sync = async () => {
      const info = await invoke<PairingInfo | null>("mobile_pairing_status").catch(
        () => null,
      );
      if (stopped) return;
      const connected = Boolean(info?.deviceConnected);
      setMobileConnectionStatus(connected, info?.host ?? null);
      if (previousConnected !== null && previousConnected !== connected) {
        const hostName = info?.host ?? "Poly device";
        if (connected) {
          notify.success("Device connected", hostName);
          if (notificationsEnabled) sendNotification({ title: "Poly device connected", body: hostName });
        } else {
          notify.info("Device disconnected", hostName);
          if (notificationsEnabled) sendNotification({ title: "Poly device disconnected", body: hostName });
        }
      }
      previousConnected = connected;
      if (!info) {
        bridge?.stop();
        bridge = null;
        return;
      }
      const key = keys.get(info.token) ?? createRelayKeyPair();
      keys.set(info.token, key);
      if (relay && !bridge) {
        bridge = new RelayHostBridge(info, relay, key);
        bridge.start();
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      bridge?.stop();
    };
  }, [notificationsEnabled, notify]);
}
