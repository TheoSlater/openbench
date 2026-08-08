import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("src/features/onboarding/OnboardingShell.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("onboarding shell boundaries", () => {
  it("locks navigation and makes exiting steps inert", () => {
    expect(shell).toContain("transitioning || closing");
    expect(shell).toContain("inert={!isPresent}");
    expect(shell).toContain("motionDuration(\"step\"");
  });

  it("persists completion before handing control back to the app", () => {
    expect(shell).toContain("completeOnboarding();");
    expect(shell).toContain("onFinished(finishTarget)");
    expect(shell).toContain("setClosing(false);");
    expect(app).toContain("<OnboardingShell");
    expect(app).toContain("onOpenOnboarding={handleOpenOnboarding}");
    expect(app).not.toContain("AuthModalLazy");
  });
});
