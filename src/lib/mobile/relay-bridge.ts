import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
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

type StoredRelayIdentity = { token: string; secretKey: string; publicKey: string };
const RELAY_IDENTITY_KEY = "poly.mobile-relay-identity.v1";

function loadStoredRelayIdentity(): StoredRelayIdentity | null {
  try {
    const raw = localStorage.getItem(RELAY_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRelayIdentity;
    if (!parsed?.token || !parsed?.secretKey || !parsed?.publicKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeRelayIdentity(identity: StoredRelayIdentity) {
  try {
    localStorage.setItem(RELAY_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage unavailable; the session just won't survive a restart.
  }
}

function clearStoredRelayIdentity() {
  try {
    localStorage.removeItem(RELAY_IDENTITY_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function relayIdentityForToken(token: string): RelayKeyPair {
  const stored = loadStoredRelayIdentity();
  if (stored?.token === token) {
    const pair = { secretKey: stored.secretKey, publicKey: stored.publicKey };
    keys.set(token, pair);
    return pair;
  }
  const pair = keys.get(token) ?? createRelayKeyPair();
  keys.set(token, pair);
  storeRelayIdentity({ token, secretKey: pair.secretKey, publicKey: pair.publicKey });
  return pair;
}

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
  const key = relayIdentityForToken(info.token);
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

export function isRelayStreamResponse(response: Response) {
  return Boolean(response.body)
    && response.headers.get("content-type")?.includes("text/event-stream") === true;
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

  unpair() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "unpair" }));
    }
    this.stop();
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
      const local = new URL(this.info.httpBaseUrl);
      local.hostname = "127.0.0.1";
      const url = new URL(request.path, local);
      url.searchParams.set("token", this.info.token);
      const response = await fetch(url, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: request.body,
      });
      if (isRelayStreamResponse(response) && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          this.send({
            type: "stream",
            id: request.id,
            data: decoder.decode(next.value, { stream: true }),
          });
        }
        const remainder = decoder.decode();
        if (remainder) this.send({ type: "stream", id: request.id, data: remainder });
        this.send({ type: "stream-end", id: request.id, status: response.status });
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
  const mobileWebAccess = useSettingsStore((state) => state.general.mobileWebAccess);
  const experimentalFeatures = useSettingsStore((state) => state.general.experimentalFeatures);
  const canUseMobileWeb = experimentalFeatures && mobileWebAccess;
  const bridgeRef = useRef<RelayHostBridge | null>(null);
  useEffect(() => {
    const relay = import.meta.env.VITE_POLY_RELAY_URL as string | undefined;

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
        bridgeRef.current?.stop();
        bridgeRef.current = null;
        return;
      }
      const key = relayIdentityForToken(info.token);
      if (relay && !bridgeRef.current) {
        bridgeRef.current = new RelayHostBridge(info, relay, key);
        bridgeRef.current.start();
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      bridgeRef.current?.stop();
      bridgeRef.current = null;
    };
  }, [notificationsEnabled, notify]);

  const hadAccess = useRef(mobileWebAccess && experimentalFeatures);
  useEffect(() => {
    if (canUseMobileWeb) {
      const stored = loadStoredRelayIdentity();
      void invoke("mobile_pairing_start", { token: stored?.token ?? null }).catch(
        () => undefined,
      );
    } else if (hadAccess.current) {
      if (!mobileWebAccess) {
        bridgeRef.current?.unpair();
        bridgeRef.current = null;
        clearStoredRelayIdentity();
      }
      void invoke("mobile_pairing_stop").catch(() => undefined);
    }
    hadAccess.current = canUseMobileWeb;
  }, [canUseMobileWeb, mobileWebAccess]);
}
