import { describe, expect, it } from "vitest";
import { shortTimeAgo } from "../src/features/sidebar/components/sidebar-utils";

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

describe("shortTimeAgo", () => {
  it("compacts each unit", () => {
    expect(shortTimeAgo(ago(5))).toBe("now");
    expect(shortTimeAgo(ago(90))).toBe("1m");
    expect(shortTimeAgo(ago(3 * 3600))).toBe("3h");
    expect(shortTimeAgo(ago(2 * 86400))).toBe("2d");
    expect(shortTimeAgo(ago(14 * 86400))).toBe("2w");
    expect(shortTimeAgo(ago(60 * 86400))).toBe("2mo");
    expect(shortTimeAgo(ago(400 * 86400))).toBe("1y");
  });
});
