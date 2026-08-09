import { describe, expect, it } from "vitest";

import { isRelayStreamResponse, relayPairingPayload } from "@/lib/mobile/relay-bridge";
import { deriveRelayKey } from "@/lib/mobile/relay-crypto";

describe("relayPairingPayload", () => {
  it("includes the desktop default model", () => {
    const payload = JSON.parse(relayPairingPayload(
      { httpBaseUrl: "http://127.0.0.1:3000", host: "Mac", token: "pairing-token" },
      "wss://relay.example.com/ws",
      { connectionId: "connection-1", name: "gpt-5" },
    ));

    expect(payload.defaultModel).toEqual({ connectionId: "connection-1", name: "gpt-5" });
  });

  it("normalizes a relay hostname to the HTTPS origin expected by clients", () => {
    const payload = JSON.parse(relayPairingPayload(
      { httpBaseUrl: "http://127.0.0.1:3000", host: "Mac", token: "pairing-token" },
      "poly-ui-production-6c40.up.railway.app",
    ));

    expect(payload.relayUrl).toBe("https://poly-ui-production-6c40.up.railway.app");
  });
});

it("forwards resumed SSE streams", () => {
  expect(isRelayStreamResponse(new Response("event: snapshot\n\n", {
    headers: { "content-type": "text/event-stream" },
  }))).toBe(true);
});

it("uses the shared Expo/native relay HKDF context", () => {
  expect(deriveRelayKey(
    "0101010101010101010101010101010101010101010101010101010101010101",
    "ce8d3ad1ccb633ec7b70c17814a5c76ecd029685050d344745ba05870e587d59",
  )).toBe("14a354072e8eb4d31a9186a9aa07e5aa4a088f300a9c5c09932b7738f266fd4f");
});
