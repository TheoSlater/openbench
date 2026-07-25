import { decodeCefFrame } from "../src/features/viewport/cefFrame";

describe("decodeCefFrame", () => {
  it("decodes dirty-rect BGRA pixels into RGBA", () => {
    const packet = new ArrayBuffer(48);
    const view = new DataView(packet);
    view.setUint32(0, 1, true);
    view.setUint32(4, 4, true);
    view.setUint32(8, 3, true);
    view.setUint32(12, 1, true);
    view.setFloat64(16, 1234.5, true);
    view.setInt32(24, 1, true);
    view.setInt32(28, 2, true);
    view.setInt32(32, 2, true);
    view.setInt32(36, 1, true);
    new Uint8Array(packet, 40).set([10, 20, 30, 255, 40, 50, 60, 128]);

    const frame = decodeCefFrame(packet);

    expect(frame.width).toBe(4);
    expect(frame.height).toBe(3);
    expect(frame.paintedAtMs).toBe(1234.5);
    expect(frame.rects).toEqual([
      {
        x: 1,
        y: 2,
        width: 2,
        height: 1,
        pixels: new Uint8ClampedArray([30, 20, 10, 255, 60, 50, 40, 128]),
      },
    ]);
  });

  it("rejects truncated packets", () => {
    expect(() => decodeCefFrame(new ArrayBuffer(23))).toThrow("CEF frame packet");
  });
});
