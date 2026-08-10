import { backupCorruptStorageItem } from "@/lib/utils/startupDiagnostics";

export const ONBOARDING_STORAGE_KEY = "polyui:onboarding";
export const ONBOARDING_VERSION = 3;

export const ONBOARDING_STEPS = [
  "provider",
  "profile",
  "preferences",
  "ready",
] as const;

export const ONBOARDING_LAST_STEP = ONBOARDING_STEPS.length - 1;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingRecord = {
  version: number;
  completed: boolean;
  lastCompletedStep: number;
  confirmedSteps: number[];
};

function defaultRecord(): OnboardingRecord {
  return {
    version: ONBOARDING_VERSION,
    completed: false,
    lastCompletedStep: -1,
    confirmedSteps: [],
  };
}

export function readOnboardingRecord(): OnboardingRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OnboardingRecord>;
    if (
      value.version !== ONBOARDING_VERSION ||
      typeof value.completed !== "boolean" ||
      typeof value.lastCompletedStep !== "number" ||
      !Array.isArray(value.confirmedSteps)
    ) {
      throw new Error("Invalid onboarding record");
    }
    return {
      version: ONBOARDING_VERSION,
      completed: value.completed,
      lastCompletedStep: Math.max(-1, Math.min(ONBOARDING_LAST_STEP, Math.trunc(value.lastCompletedStep))),
      confirmedSteps: value.confirmedSteps.filter(
        (step): step is number => Number.isInteger(step) && step >= 0 && step <= ONBOARDING_LAST_STEP,
      ),
    };
  } catch (error) {
    if (raw) backupCorruptStorageItem(ONBOARDING_STORAGE_KEY, raw, error);
    return null;
  }
}

function writeRecord(record: OnboardingRecord): void {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(record));
}

export function confirmOnboardingStep(step: number): void {
  const current = readOnboardingRecord() ?? defaultRecord();
  const confirmedSteps = [...new Set([...current.confirmedSteps, step])].sort((a, b) => a - b);
  writeRecord({
    ...current,
    lastCompletedStep: Math.max(current.lastCompletedStep, step),
    confirmedSteps,
  });
}

export function completeOnboarding(): void {
  writeRecord({
    version: ONBOARDING_VERSION,
    completed: true,
    lastCompletedStep: ONBOARDING_LAST_STEP,
    confirmedSteps: ONBOARDING_STEPS.map((_, index) => index),
  });
}

export function nextOnboardingStep(record: OnboardingRecord | null): number {
  if (!record || record.completed) return 0;
  return Math.min(ONBOARDING_LAST_STEP, record.lastCompletedStep + 1);
}

/** Existing installs already have a working app; do not force a new wizard onto them. */
export function hasExistingInstall(): boolean {
  return ["session_token", "polyui.guestId", "polyui:settings", "theme_mode"].some(
    (key) => Boolean(localStorage.getItem(key)),
  );
}

export function preserveExistingInstall(): void {
  if (!readOnboardingRecord() && hasExistingInstall()) completeOnboarding();
}
