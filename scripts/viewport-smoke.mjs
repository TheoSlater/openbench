// Standalone proof that the CEF helper renders without the app.
//
// Spawns polyui-viewport, opens a page, and writes the first painted frame to
// a PNG. This is the artifact the original spike (CP2 in spike-notes.md) never
// produced. Usage:
//
//   node scripts/viewport-smoke.mjs [url] [outfile.png]

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const url = process.argv[2] ?? "https://example.com";
const outFile = process.argv[3] ?? "viewport-smoke.png";
const WIDTH = 800;
const HEIGHT = 600;
const TAGS = ["frame", "cursor", "address", "navState", "error"];

const helper = spawn("src-tauri/target/debug/polyui-viewport", [], {
  stdio: ["pipe", "pipe", "inherit"],
});

const send = (obj) => helper.stdin.write(`${JSON.stringify(obj)}\n`);
send({ cmd: "open", id: 1, url, width: WIDTH, height: HEIGHT, scaleFactor: 1 });

let buffer = Buffer.alloc(0);
let done = false;

helper.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  // u32 length | u8 tag | u32 id | payload
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const tag = buffer[4];
    const id = buffer.readUInt32LE(5);
    const payload = buffer.subarray(9, 4 + length);
    buffer = buffer.subarray(4 + length);
    handle(TAGS[tag] ?? `unknown(${tag})`, id, payload);
  }
});

// Persistent BGRA surface, exactly as the canvas keeps one: every frame only
// carries dirty rects, so compositing here is what proves the rect protocol.
let surface = null;
let surfaceSize = { width: 0, height: 0 };
let settle = null;

function handle(tag, id, payload) {
  if (tag === "frame") {
    if (done) return;
    const frame = decodeFrame(payload);
    console.log(
      `frame  id=${id} ${frame.width}x${frame.height} rects=${frame.rectCount} ` +
        `bytes=${payload.length}`,
    );
    composite(frame);
    return;
  }
  console.log(`${tag.padEnd(7)} id=${id} ${payload.toString("utf8").slice(0, 120)}`);
  if (tag === "navState" && JSON.parse(payload.toString("utf8")).isLoading === false) {
    // Give the paint after load-finished a moment to arrive, then capture.
    clearTimeout(settle);
    settle = setTimeout(finish, 1500);
  }
}

function composite(frame) {
  if (!surface || surfaceSize.width !== frame.width || surfaceSize.height !== frame.height) {
    surface = Buffer.alloc(frame.width * frame.height * 4);
    surfaceSize = { width: frame.width, height: frame.height };
  }
  let offset = 0;
  for (const rect of frame.rects) {
    for (let row = 0; row < rect.height; row += 1) {
      const src = offset + row * rect.width * 4;
      const dst = ((rect.y + row) * frame.width + rect.x) * 4;
      frame.pixels.copy(surface, dst, src, src + rect.width * 4);
    }
    offset += rect.width * rect.height * 4;
  }
}

function finish() {
  if (done || !surface) return;
  done = true;
  writeFileSync(
    outFile,
    encodePng({ width: surfaceSize.width, height: surfaceSize.height, pixels: surface }),
  );
  console.log(`\nwrote ${outFile} (${surfaceSize.width}x${surfaceSize.height})`);
  send({ cmd: "shutdown" });
  helper.stdin.end();
  setTimeout(() => helper.kill(), 1500);
}

function decodeFrame(packet) {
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

// Minimal PNG writer: the frame is a single full-surface BGRA rect.
function encodePng({ width, height, pixels }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = y * (width * 4 + 1) + 1 + x * 4;
      raw[dst] = pixels[src + 2]; // B -> R
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src]; // R -> B
      raw[dst + 3] = pixels[src + 3];
    }
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4);
    data.copy(out, 8);
    out.writeInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) | 0;
}

setTimeout(() => {
  if (!done) {
    console.error("\nNo full frame within 30s.");
    helper.kill();
    process.exit(1);
  }
}, 30000);
