import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export type RelayKeyPair = { secretKey: string; publicKey: string };
export type RelayCiphertext = { nonce: string; ciphertext: string };

// Must stay byte-for-byte compatible with the Expo client and native iOS
// client. This string is part of the relay wire protocol.
const RELAY_SESSION_INFO = "poly-session-v1";

export function createRelayKeyPair(): RelayKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return {
    secretKey: bytesToHex(secretKey),
    publicKey: bytesToHex(x25519.getPublicKey(secretKey)),
  };
}

export function deriveRelayKey(secretKey: string, peerPublicKey: string) {
  return bytesToHex(
    hkdf(
      sha256,
      x25519.getSharedSecret(hexToBytes(secretKey), hexToBytes(peerPublicKey)),
      undefined,
      utf8ToBytes(RELAY_SESSION_INFO),
      32,
    ),
  );
}

export function encryptRelay(value: unknown, key: string): RelayCiphertext {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ciphertext = xchacha20poly1305(hexToBytes(key), nonce).encrypt(
    utf8ToBytes(JSON.stringify(value)),
  );
  return { nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}

export function decryptRelay<T>(value: RelayCiphertext, key: string): T {
  const plaintext = xchacha20poly1305(
    hexToBytes(key),
    hexToBytes(value.nonce),
  ).decrypt(hexToBytes(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
