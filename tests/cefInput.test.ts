import { describe, expect, it } from "vitest";
import {
  cefCoordinates,
  cefKeyEvents,
  cefModifiers,
  cefWheelDelta,
} from "../src/features/viewport/cefInput";

describe("CEF viewport input", () => {
  it("maps CSS coordinates to the canvas backing store", () => {
    expect(cefCoordinates(110, 70, { left: 10, top: 20, width: 200, height: 100 }, 400, 200)).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("maps wheel units to CEF pixels and reverses wheel direction", () => {
    expect(cefWheelDelta(2, -3, 0, 500)).toEqual({ deltaX: -2, deltaY: 3 });
    expect(cefWheelDelta(0, 2, 1, 500)).toEqual({ deltaX: 0, deltaY: -80 });
    expect(cefWheelDelta(0, 1, 2, 500)).toEqual({ deltaX: 0, deltaY: -500 });
  });

  it("builds CEF modifier flags including held mouse buttons", () => {
    expect(
      cefModifiers({
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        buttons: 3,
        location: 1,
        capsLock: true,
        numLock: false,
      }),
    ).toBe(1 | 2 | 4 | 8 | 16 | 64 | 1024);
  });

  it("emits raw-keydown plus char, then keyup", () => {
    const source = {
      key: "A",
      keyCode: 65,
      location: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      capsLock: false,
      numLock: false,
    };

    expect(cefKeyEvents(source, "down")).toMatchObject([
      { kind: "key", eventType: "raw_key_down", windowsKeyCode: 65, character: 0 },
      { kind: "key", eventType: "char", character: 65, unmodifiedCharacter: 97 },
    ]);
    expect(cefKeyEvents(source, "up")).toMatchObject([
      { kind: "key", eventType: "key_up", windowsKeyCode: 65 },
    ]);
  });

  it("does not emit char events for control shortcuts", () => {
    expect(
      cefKeyEvents(
        {
          key: "c",
          keyCode: 67,
          location: 0,
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          capsLock: false,
          numLock: false,
        },
        "down",
      ),
    ).toHaveLength(1);
  });
});
