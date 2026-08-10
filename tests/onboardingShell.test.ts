import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("src/features/onboarding/OnboardingShell.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

describe("onboarding shell boundaries", () => {
  it("locks navigation and makes exiting steps inert", () => {
    expect(shell).toContain("transitioning || closing");
    expect(shell).toContain("inert={!isPresent}");
    expect(shell).toContain('motionDuration(isPresent ? "step" : "stepExit"');
    expect(shell).toContain('ease: isPresent ? onboardingMotion.ease.enter : onboardingMotion.ease.exit');
    expect(shell).toContain('mode="wait"');
    expect(shell).toContain("ProfileStep");
    expect(shell).toContain("flex-col gap-3 sm:flex-row");
    expect(shell).toContain('scale: 0.985, filter: "blur(5px)"');
    expect(main).toContain('className="app-content relative zoom-content animate-fade-in"');
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
