// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  completeOnboarding,
  confirmOnboardingStep,
  hasExistingInstall,
  nextOnboardingStep,
  preserveExistingInstall,
  readOnboardingRecord,
} from "@/features/onboarding/persistence";

describe("onboarding persistence", () => {
  beforeEach(() => localStorage.clear());

  it("restores the next unconfirmed step without writing a draft", () => {
    expect(nextOnboardingStep(null)).toBe(0);
    confirmOnboardingStep(1);
    expect(readOnboardingRecord()).toMatchObject({
      completed: false,
      lastCompletedStep: 1,
      confirmedSteps: [1],
    });
    expect(nextOnboardingStep(readOnboardingRecord())).toBe(2);
  });

  it("keeps existing installs out of first-launch onboarding", () => {
    localStorage.setItem("polyui:settings", "{}{");
    expect(hasExistingInstall()).toBe(true);
    preserveExistingInstall();
    expect(readOnboardingRecord()?.completed).toBe(true);
  });

  it("only marks onboarding complete at the final action", () => {
    confirmOnboardingStep(1);
    expect(readOnboardingRecord()?.completed).toBe(false);
    completeOnboarding();
    expect(readOnboardingRecord()).toMatchObject({
      completed: true,
      lastCompletedStep: 3,
      confirmedSteps: [0, 1, 2, 3],
    });
    expect(nextOnboardingStep(readOnboardingRecord())).toBe(0);
  });
});
