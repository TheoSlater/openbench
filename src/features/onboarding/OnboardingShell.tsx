import {
  AnimatePresence,
  MotionConfig,
  motion,
  useIsPresent,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import {
  useSettingsStore,
  type CapabilityMode,
  type LocalProfile,
} from "@/store/settingsStore";
import { useThemeStore, type ThemeMode } from "@/store/themeStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  ONBOARDING_STEPS,
  completeOnboarding,
  confirmOnboardingStep,
  nextOnboardingStep,
  readOnboardingRecord,
} from "./persistence";
import { motionDuration, onboardingMotion } from "./motion";
import {
  AppearanceStep,
  CapabilitiesStep,
  ProfileStep,
  ProviderStep,
  ReadyStep,
  type ProviderSummaryItem,
  WelcomeStep,
} from "./OnboardingSteps";
import { normalizeDisplayName } from "./profile";

const STEP_LABELS = [
  "Welcome",
  "Profile",
  "Model",
  "Access",
  "Appearance",
  "Done",
] as const;

const STEP_DISTANCE = onboardingMotion.distance.step;
const STEP_EXIT_DISTANCE = onboardingMotion.distance.stepExit;

type StepIndex = number;
export type OnboardingFinishTarget = "chat" | "settings";

type OnboardingShellProps = {
  open: boolean;
  onFinished: (target: OnboardingFinishTarget) => void;
};

function clampStep(step: number): StepIndex {
  return Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Math.trunc(step)));
}

function initialProfile(): LocalProfile {
  const settings = useSettingsStore.getState();
  const user = useAuthStore.getState().user;
  return {
    displayName: settings.profileConfigured
      ? settings.profile.displayName
      : user?.fullName ?? "",
    avatarUrl: settings.profileConfigured ? settings.profile.avatarUrl : null,
  };
}

function initialCapability(): CapabilityMode {
  return useSettingsStore.getState().capabilityMode ?? "chat-only";
}

function initialAppearance(): ThemeMode {
  const mode = useThemeStore.getState().mode;
  return mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
}

const stepVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? STEP_DISTANCE : -STEP_DISTANCE,
  }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -STEP_EXIT_DISTANCE : STEP_EXIT_DISTANCE,
  }),
};

function StepProgress({ step }: { step: StepIndex }) {
  const label = `Step ${step + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[step]}`;

  return (
    <div
      className="mx-auto flex w-full max-w-2xl items-center gap-4"
      role="progressbar"
      aria-label="Onboarding progress"
      aria-valuemin={1}
      aria-valuemax={STEP_LABELS.length}
      aria-valuenow={step + 1}
      aria-valuetext={label}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Setup</span>
          <span>{step + 1} of {STEP_LABELS.length}</span>
        </div>
        <div className="mt-2 h-px overflow-hidden bg-border">
          <motion.span
            className="block h-px bg-foreground"
            initial={false}
            animate={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }}
            transition={{ duration: onboardingMotion.duration.standard, ease: onboardingMotion.ease.standard }}
          />
        </div>
      </div>
      <span className="hidden shrink-0 text-sm font-medium text-foreground sm:block">
        {STEP_LABELS[step]}
      </span>
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </div>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function StepContent({
  step,
  headingRef,
  profile,
  setProfile,
  capability,
  setCapability,
  appearance,
  setAppearance,
  providers,
  onSummaryChange,
}: {
  step: StepIndex;
  headingRef: RefObject<HTMLHeadingElement | null>;
  profile: LocalProfile;
  setProfile: (profile: LocalProfile) => void;
  capability: CapabilityMode;
  setCapability: (capability: CapabilityMode) => void;
  appearance: ThemeMode;
  setAppearance: (appearance: ThemeMode) => void;
  providers: ProviderSummaryItem[];
  onSummaryChange: (summary: ProviderSummaryItem[]) => void;
}) {
  switch (step) {
    case 0:
      return <WelcomeStep headingRef={headingRef} />;
    case 1:
      return <ProfileStep profile={profile} setProfile={setProfile} headingRef={headingRef} />;
    case 2:
      return (
        <ProviderStep
          headingRef={headingRef}
          onSummaryChange={onSummaryChange}
        />
      );
    case 3:
      return (
        <CapabilitiesStep
          capability={capability}
          setCapability={setCapability}
          headingRef={headingRef}
        />
      );
    case 4:
      return (
        <AppearanceStep
          appearance={appearance}
          setAppearance={setAppearance}
          headingRef={headingRef}
        />
      );
    default:
      return (
        <ReadyStep
          profile={profile}
          capability={capability}
          appearance={appearance}
          providers={providers}
          headingRef={headingRef}
        />
      );
  }
}

function AnimatedStep({
  step,
  direction,
  reducedMotion,
  headingRef,
  profile,
  setProfile,
  capability,
  setCapability,
  appearance,
  setAppearance,
  providers,
  onSummaryChange,
}: {
  step: StepIndex;
  direction: number;
  reducedMotion: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  profile: LocalProfile;
  setProfile: (profile: LocalProfile) => void;
  capability: CapabilityMode;
  setCapability: (capability: CapabilityMode) => void;
  appearance: ThemeMode;
  setAppearance: (appearance: ThemeMode) => void;
  providers: ProviderSummaryItem[];
  onSummaryChange: (summary: ProviderSummaryItem[]) => void;
}) {
  const isPresent = useIsPresent();

  return (
    <motion.section
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{
        duration: motionDuration(isPresent ? "step" : "stepExit", reducedMotion),
        ease: isPresent ? onboardingMotion.ease.enter : onboardingMotion.ease.exit,
      }}
      aria-hidden={!isPresent}
      inert={!isPresent}
      className="onboarding-step absolute inset-0 flex min-h-full w-full items-start overflow-y-auto overscroll-contain py-4"
    >
      <div className="my-auto flex w-full items-start justify-start py-4">
        <StepContent
          step={step}
          headingRef={headingRef}
          profile={profile}
          setProfile={setProfile}
          capability={capability}
          setCapability={setCapability}
          appearance={appearance}
          setAppearance={setAppearance}
          providers={providers}
          onSummaryChange={onSummaryChange}
        />
      </div>
    </motion.section>
  );
}

export function OnboardingShell({ open, onFinished }: OnboardingShellProps) {
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<StepIndex>(() =>
    clampStep(nextOnboardingStep(readOnboardingRecord())),
  );
  const [direction, setDirection] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [finishTarget, setFinishTarget] = useState<OnboardingFinishTarget | null>(null);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<LocalProfile>(initialProfile);
  const [capability, setCapability] = useState<CapabilityMode>(initialCapability);
  const [appearance, setAppearance] = useState<ThemeMode>(initialAppearance);
  const [providers, setProviders] = useState<ProviderSummaryItem[]>([]);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const transitionTimer = useRef<number | null>(null);

  const { settingsActions } = useSettingsStore(
    useShallow((state) => ({ settingsActions: state.actions })),
  );
  const { setMode, setPreviewMode } = useThemeStore(
    useShallow((state) => ({
      setMode: state.setMode,
      setPreviewMode: state.setPreviewMode,
    })),
  );

  useEffect(() => {
    if (!open) {
      setPreviewMode(null);
      setClosing(false);
      return;
    }

    setStep(clampStep(nextOnboardingStep(readOnboardingRecord())));
    setDirection(1);
    setTransitioning(false);
    setClosing(false);
    setFinishTarget(null);
    setError("");
    setProfile(initialProfile());
    setCapability(initialCapability());
    setAppearance(initialAppearance());
    setProviders([]);
    setPreviewMode(null);
  }, [open, setPreviewMode]);

  useEffect(() => {
    return () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open || closing) return;
    const focusTimer = window.setTimeout(() => headingRef.current?.focus(), 20);
    return () => window.clearTimeout(focusTimer);
  }, [open, closing]);

  useEffect(() => {
    if (!closing || !finishTarget) return;
    const timer = window.setTimeout(() => onFinished(finishTarget), motionDuration("final", reducedMotion) * 1000 + 30);
    return () => window.clearTimeout(timer);
  }, [closing, finishTarget, onFinished, reducedMotion]);

  const handleSummaryChange = useCallback((summary: ProviderSummaryItem[]) => {
    setProviders(summary);
  }, []);

  const persist = useCallback((action: () => void, stepToConfirm: number) => {
    try {
      action();
      confirmOnboardingStep(stepToConfirm);
      setError("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PolyUI could not save this step.");
      return false;
    }
  }, []);

  const saveProfile = useCallback(() => {
    const normalized = normalizeDisplayName(profile.displayName);
    return persist(
      () => settingsActions.setProfile({ displayName: normalized, avatarUrl: profile.avatarUrl }),
      1,
    );
  }, [persist, profile.avatarUrl, profile.displayName, settingsActions]);

  const moveTo = useCallback(
    (next: StepIndex) => {
      if (transitioning || closing || next === step) return;
      setDirection(next > step ? 1 : -1);
      setStep(clampStep(next));
      setTransitioning(true);
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => {
        setTransitioning(false);
        headingRef.current?.focus();
      }, motionDuration("step", reducedMotion) * 1000 + 20);
    },
    [closing, reducedMotion, step, transitioning],
  );

  const goBack = useCallback(() => {
    if (step > 0) moveTo(step - 1);
  }, [moveTo, step]);

  const finish = useCallback(
    (target: OnboardingFinishTarget) => {
      if (closing || transitioning) return;
      try {
        completeOnboarding();
        setPreviewMode(null);
        setError("");
        setFinishTarget(target);
        setClosing(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "PolyUI could not finish setup.");
      }
    },
    [closing, setPreviewMode, transitioning],
  );

  const goNext = useCallback(() => {
    if (transitioning || closing) return;
    if (step === 0) {
      if (persist(() => undefined, 0)) moveTo(1);
      return;
    }
    if (step === 1) {
      if (saveProfile()) moveTo(2);
      return;
    }
    if (step === 2) {
      if (persist(() => undefined, 2)) moveTo(3);
      return;
    }
    if (step === 3) {
      if (persist(() => settingsActions.setCapabilityMode(capability), 3)) moveTo(4);
      return;
    }
    if (step === 4) {
      if (persist(() => setMode(appearance), 4)) moveTo(5);
      return;
    }
    finish("chat");
  }, [appearance, capability, closing, finish, moveTo, persist, saveProfile, setMode, settingsActions, step, transitioning]);

  const skipCurrent = useCallback(() => {
    if (transitioning || closing) return;
    if (step === 1) {
      if (saveProfile()) moveTo(2);
      return;
    }
    if (step === 2) {
      if (persist(() => undefined, 2)) moveTo(3);
    }
  }, [closing, moveTo, persist, saveProfile, step, transitioning]);

  const previewAppearance = useCallback(
    (next: ThemeMode) => {
      setAppearance(next);
      setPreviewMode(next);
    },
    [setPreviewMode],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.key !== "Enter" || isTextEntry(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest("button, [role='button']")) return;
      event.preventDefault();
      goNext();
    },
    [goNext],
  );

  if (!open && !closing) return null;

  const primaryLabel = step === 0 ? "Get started" : step === 5 ? "Start chatting" : "Continue";
  const secondaryLabel = step === 1 ? "Skip for now" : step === 2 ? "Set up later" : step === 5 ? "Open settings" : null;
  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
      <motion.div
        className="onboarding-surface absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden text-foreground"
        role="region"
        aria-label="PolyUI onboarding"
        onKeyDown={onKeyDown}
        animate={closing ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
        transition={{
          duration: closing ? motionDuration("final", reducedMotion) : motionDuration("entrance", reducedMotion),
          ease: closing ? onboardingMotion.ease.exit : onboardingMotion.ease.enter,
        }}
      >
        <header className="relative z-10 flex min-h-[72px] shrink-0 items-center border-b border-border/60 px-6 py-4 sm:px-8">
          <StepProgress step={step} />
        </header>

        <div className="relative z-10 min-h-0 flex-1 overflow-hidden px-4 sm:px-8">
          <div className="relative mx-auto flex min-h-full w-full max-w-2xl items-center justify-center py-8 sm:py-10">
            <AnimatePresence initial={false} custom={direction} mode="sync">
              <AnimatedStep
                key={step}
                step={step}
                direction={direction}
                reducedMotion={reducedMotion}
                headingRef={headingRef}
                profile={profile}
                setProfile={setProfile}
                capability={capability}
                setCapability={setCapability}
                appearance={appearance}
                setAppearance={previewAppearance}
                providers={providers}
                onSummaryChange={handleSummaryChange}
              />
            </AnimatePresence>
          </div>
        </div>

        <footer className="relative z-10 flex min-h-[88px] shrink-0 items-center border-t border-border/60 px-4 py-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
            <div className="min-h-5 text-center">
              <AnimatePresence initial={false} mode="wait">
                {error ? (
                  <motion.p
                    key={error}
                    role="alert"
                    className="text-sm text-destructive"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: motionDuration("standard", reducedMotion) }}
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
            <div className="flex items-center justify-between gap-3">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={transitioning || closing}
                >
                  Back
                </Button>
              ) : <span aria-hidden="true" />}
              <div className="flex min-w-0 flex-1 justify-end gap-2">
                {secondaryLabel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={step === 5 ? () => finish("settings") : skipCurrent}
                    disabled={transitioning || closing}
                  >
                    {secondaryLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  className="min-w-0 flex-1 sm:min-w-32 sm:flex-none"
                  onClick={goNext}
                  disabled={transitioning || closing}
                >
                  {primaryLabel}
                </Button>
              </div>
            </div>
          </div>
        </footer>
      </motion.div>
    </MotionConfig>
  );
}
