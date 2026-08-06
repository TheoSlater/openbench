import { describe, it, expect } from "vitest";
import { tagAppVersion } from "../src/lib/utils/appVersion";

describe("tagAppVersion", () => {
  it("returns the plain version when neither tag applies", () => {
    expect(tagAppVersion("0.22.0", { dirty: false, stale: false })).toBe("0.22.0");
  });

  it("appends -dirty for a dev build with uncommitted changes", () => {
    expect(tagAppVersion("0.22.0", { dirty: true, stale: false })).toBe("0.22.0-dirty");
  });

  it("appends -stale when a newer release is available", () => {
    expect(tagAppVersion("0.22.0", { dirty: false, stale: true })).toBe("0.22.0-stale");
  });

  it("combines dirty and stale tags", () => {
    expect(tagAppVersion("0.22.0", { dirty: true, stale: true })).toBe("0.22.0-dirty-stale");
  });

  it("handles a null version", () => {
    expect(tagAppVersion(null, { dirty: true, stale: true })).toBeNull();
  });
});