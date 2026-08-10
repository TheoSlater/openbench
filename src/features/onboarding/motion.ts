export const onboardingMotion = {
  duration: {
    instant: 0.08,
    fast: 0.14,
    standard: 0.2,
    expansion: 0.28,
    step: 0.38,
    stepExit: 0.26,
    entrance: 0.55,
    final: 0.46,
  },
  distance: {
    small: 4,
    step: 14,
    stepExit: 8,
    hover: 2,
  },
  scale: {
    subtle: 0.985,
    pressed: 0.99,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
    standard: [0.4, 0, 0.2, 1] as const,
  },
} as const;

export function motionDuration(
  name: keyof typeof onboardingMotion.duration,
  reduced: boolean,
): number {
  return reduced ? onboardingMotion.duration.instant : onboardingMotion.duration[name];
}
