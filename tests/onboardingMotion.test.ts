import { describe, expect, it } from "vitest";
import { motionDuration, onboardingMotion } from "@/features/onboarding/motion";

describe("onboarding motion tokens", () => {
  it("keeps transitions distinct and reduced motion short", () => {
    expect(onboardingMotion.duration.fast).toBeLessThan(onboardingMotion.duration.step);
    expect(onboardingMotion.duration.step).toBeLessThan(onboardingMotion.duration.final + 0.01);
    expect(motionDuration("step", true)).toBeLessThan(motionDuration("step", false));
  });
});
