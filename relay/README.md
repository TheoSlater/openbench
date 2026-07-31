# Poly relay

Self-host this Bun service for remote desktop/mobile access.

PORT=8787 bun run relay

Set VITE_POLY_RELAY_URL in the desktop build to the public HTTPS relay URL.
The client upgrades it to wss://.../ws. The relay authenticates the pairing
token and forwards only X25519/XChaCha20 encrypted frames.
