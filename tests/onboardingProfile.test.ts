import { describe, expect, it } from "vitest";
import {
  normalizeDisplayName,
  profileInitials,
  profileLabel,
  PROFILE_NAME_MAX,
} from "@/features/onboarding/profile";

describe("local onboarding profile", () => {
  it("trims names while allowing spaces and Unicode", () => {
    expect(normalizeDisplayName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeDisplayName("Zoë 日本語")).toBe("Zoë 日本語");
    expect(profileLabel("   ")).toBe("You");
  });

  it("uses a conservative maximum and stable initials fallback", () => {
    expect(normalizeDisplayName("x".repeat(PROFILE_NAME_MAX + 20))).toHaveLength(PROFILE_NAME_MAX);
    expect(profileInitials("Ada Lovelace")).toBe("AL");
    expect(profileInitials("")).toBe("Y");
  });
});
