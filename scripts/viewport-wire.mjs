// The helper's stdout framing, for the diagnostic scripts.
//
// Mirrors `Sink::send` in src-tauri/viewport/src/protocol.rs and the reader in
// src-tauri/src/viewport/process.rs. Shared so the wire format has one
// definition in JS rather than one per script — a stale copy shows up as a
// script that silently reports nothing.
//
//   u32 le length | u8 tag | u32 le id | payload   (length counts tag+id+payload)

export const TAGS = ["frame", "cursor", "address", "navState", "error"];

/**
 * Calls `onMessage(tag, id, payload)` for each message on `stream`.
 * `tag` is a name from TAGS, or `unknown(n)` if the two sides have drifted.
 */
export function readMessages(stream, onMessage) {
  let buffer = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) break;
      const tag = buffer[4];
      const id = buffer.readUInt32LE(5);
      const payload = buffer.subarray(9, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(TAGS[tag] ?? `unknown(${tag})`, id, payload);
    }
  });
}

/** Decodes a frame packet. Mirrors `decodeCefFrame` in cefFrame.ts. */
export function decodeFrame(packet) {
  const width = packet.readUInt32LE(4);
  const height = packet.readUInt32LE(8);
  const rectCount = packet.readUInt32LE(12);
  const rects = [];
  let offset = 24;
  for (let i = 0; i < rectCount; i += 1) {
    rects.push({
      x: packet.readInt32LE(offset),
      y: packet.readInt32LE(offset + 4),
      width: packet.readInt32LE(offset + 8),
      height: packet.readInt32LE(offset + 12),
    });
    offset += 16;
  }
  return { width, height, rectCount, rects, pixels: packet.subarray(offset) };
}
