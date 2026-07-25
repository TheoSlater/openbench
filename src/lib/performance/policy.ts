export type PerformanceTier = "low" | "standard";

export interface HardwareHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  reducedMotion?: boolean;
}

export interface PerformanceProfile {
  tier: PerformanceTier;
  reducedMotion: boolean;
  hardwareConcurrency: number;
  deviceMemory: number | null;
}

export function getPerformanceProfile(
  hints: HardwareHints = {},
): PerformanceProfile {
  const nav =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number })
      : undefined;
  const hardwareConcurrency =
    hints.hardwareConcurrency ?? nav?.hardwareConcurrency ?? 4;
  const deviceMemory = hints.deviceMemory ?? nav?.deviceMemory ?? null;
  const reducedMotion = hints.reducedMotion ?? false;

  const lowCpu = hardwareConcurrency <= 2;
  const lowMemory = deviceMemory !== null && deviceMemory <= 2;

  return {
    tier: reducedMotion || lowCpu || lowMemory ? "low" : "standard",
    reducedMotion,
    hardwareConcurrency,
    deviceMemory,
  };
}

export function isLowEndProfile(profile = getPerformanceProfile()) {
  return profile.tier === "low";
}

export function getMotionPolicy(profile = getPerformanceProfile()) {
  const lowEnd = isLowEndProfile(profile);
  return {
    lowEnd,
    enableLayoutAnimation: !lowEnd,
    enableCompositorAnimation: !profile.reducedMotion,
    transitionDurationMs: lowEnd ? 0 : 160,
    virtualOverscan: lowEnd ? 4 : 8,
  };
}
