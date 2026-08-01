import { describe, expect, it } from "vitest";

import { isRelayStreamResponse, relayPairingPayload } from "@/lib/mobile/relay-bridge";

describe("relayPairingPayload", () => {
  it("includes the desktop default model", () => {
    const payload = JSON.parse(relayPairingPayload(
      { httpBaseUrl: "http://127.0.0.1:3000", host: "Mac", token: "pairing-token" },
      "wss://relay.example.com/ws",
      { connectionId: "connection-1", name: "gpt-5" },
    ));

    expect(payload.defaultModel).toEqual({ connectionId: "connection-1", name: "gpt-5" });
  });
});

it("forwards resumed SSE streams", () => {
  expect(isRelayStreamResponse(new Response("event: snapshot\n\n", {
    headers: { "content-type": "text/event-stream" },
  }))).toBe(true);
});
