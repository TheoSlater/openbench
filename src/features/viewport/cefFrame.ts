const FRAME_HEADER_BYTES = 24;
const RECT_HEADER_BYTES = 16;
const FRAME_VERSION = 1;

export type CefFrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type CefFrame = {
  width: number;
  height: number;
  paintedAtMs: number;
  rects: CefFrameRect[];
};

export function decodeCefFrame(packet: ArrayBuffer): CefFrame {
  if (packet.byteLength < FRAME_HEADER_BYTES) throw new Error("CEF frame packet is truncated");
  const view = new DataView(packet);
  if (view.getUint32(0, true) !== FRAME_VERSION) throw new Error("CEF frame packet version is unsupported");

  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const rectCount = view.getUint32(12, true);
  const paintedAtMs = view.getFloat64(16, true);
  const pixelOffset = FRAME_HEADER_BYTES + rectCount * RECT_HEADER_BYTES;
  if (!width || !height || pixelOffset > packet.byteLength) throw new Error("CEF frame packet is invalid");

  const rects: CefFrameRect[] = [];
  let sourceOffset = pixelOffset;
  for (let index = 0; index < rectCount; index += 1) {
    const offset = FRAME_HEADER_BYTES + index * RECT_HEADER_BYTES;
    const x = view.getInt32(offset, true);
    const y = view.getInt32(offset + 4, true);
    const rectWidth = view.getInt32(offset + 8, true);
    const rectHeight = view.getInt32(offset + 12, true);
    const byteLength = rectWidth * rectHeight * 4;
    if (x < 0 || y < 0 || rectWidth <= 0 || rectHeight <= 0 || x + rectWidth > width || y + rectHeight > height || sourceOffset + byteLength > packet.byteLength) {
      throw new Error("CEF frame packet contains an invalid dirty rect");
    }

    const source = new Uint8Array(packet, sourceOffset, byteLength);
    const pixels = new Uint8ClampedArray(byteLength);
    for (let pixel = 0; pixel < byteLength; pixel += 4) {
      pixels[pixel] = source[pixel + 2];
      pixels[pixel + 1] = source[pixel + 1];
      pixels[pixel + 2] = source[pixel];
      pixels[pixel + 3] = source[pixel + 3];
    }
    rects.push({ x, y, width: rectWidth, height: rectHeight, pixels });
    sourceOffset += byteLength;
  }
  if (sourceOffset !== packet.byteLength) throw new Error("CEF frame packet has trailing data");
  return { width, height, paintedAtMs, rects };
}
