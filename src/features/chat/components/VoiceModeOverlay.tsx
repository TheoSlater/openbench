import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Plus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { InputBase } from "@/components/ui/input-base";
import { DictationModelDialog } from "@/features/dictation/DictationModelDialog";
import { useDictation } from "@/hooks/useDictation";
import { useIdleBlock } from "@/lib/idle";
import { matchesSleepCommand } from "@/lib/dictation/sleepCommands";
import {
  advanceBargeIn,
  advanceVoiceActivity,
  createBargeInState,
  createVoiceActivityState,
} from "@/lib/dictation/voiceActivity";
import { useSettingsStore } from "@/store/settingsStore";
import { speakableSentencePrefix, useTtsStore, warmTtsEngine } from "@/store/ttsStore";
import type { Message } from "@/types/chat";
import HeroOrb, { type HeroOrbState } from "./HeroOrb";
import { getVoiceOrbPalette } from "../voicePalettes";

// Speaker tail + room reverb bleed into the mic for a beat after playback
// stops; opening a turn inside that window transcribes the assistant's own
// voice.
const PLAYBACK_ECHO_GRACE_MS = 400;

/** Short blip when the mic opens — voice mode is used eyes-free. */
function playMicCue() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // The cue is cosmetic; never let audio quirks break the session.
  }
}

type VoiceModeOverlayProps = {
  open: boolean;
  /** Docked mode: small orb above the input bar, chat visible behind. */
  compact: boolean;
  onToggleCompact: () => void;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
  /** Stop the in-flight model response (used when the user barges in). */
  onInterrupt?: () => void;
  canSubmit: boolean;
  isResponding: boolean;
  messages: Message[];
};

export default function VoiceModeOverlay({
  open,
  compact,
  onToggleCompact,
  onClose,
  onSubmit,
  onInterrupt,
  canSubmit,
  isResponding,
  messages,
}: VoiceModeOverlayProps) {
  // A hands-free session emits no mouse/keyboard activity; without this the
  // idle manager would unload the Whisper + TTS models mid-conversation.
  useIdleBlock(open);

  const [draft, setDraft] = useState("");
  const [entered, setEntered] = useState(false);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [ttsAttempted, setTtsAttempted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const assistantIdsBeforeSend = useRef<Set<string>>(new Set());
  const pipelineIdRef = useRef<string | null>(null);
  const spokenCharsRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const vadStateRef = useRef(createVoiceActivityState(Date.now()));
  const bargeInStateRef = useRef(createBargeInState(Date.now()));
  // True while the current capture only monitors for barge-in during TTS
  // playback; its audio is discarded, never transcribed.
  const monitoringRef = useRef(false);
  const vadStoppingRef = useRef(false);
  const tts = useTtsStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      isGenerating: state.isGenerating,
      error: state.error,
      outputLevel: state.outputLevel,
      actions: state.actions,
    })),
  );

  const rememberCurrentResponses = useCallback(() => {
    assistantIdsBeforeSend.current = new Set(
      messages.filter((message) => message.role === "assistant").map((message) => message.id),
    );
    pipelineIdRef.current = null;
    spokenCharsRef.current = 0;
    setAwaitingResponse(true);
    setSessionError(false);
    setTtsAttempted(false);
  }, [messages]);

  const handleTranscript = useCallback(
    async (text: string) => {
      const transcript = text.trim();
      if (!transcript) return;
      if (matchesSleepCommand(transcript)) {
        handleClose();
        return;
      }
      if (!canSubmit) {
        setSessionError(true);
        return;
      }
      setLastHeard(transcript);
      rememberCurrentResponses();
      try {
        await onSubmit(transcript);
      } catch {
        setAwaitingResponse(false);
        setSessionError(true);
      }
    },
    [canSubmit, onSubmit, rememberCurrentResponses],
  );

  const {
    recording,
    processing,
    partialTranscript,
    error: dictationError,
    clearError,
    audioLevel,
    start,
    stop,
    cancel,
    installOpen,
    models,
    selectedModelId,
    installingModelId,
    downloadProgress,
    closeInstall,
    installModel,
    selectInstalledModel,
    // No partials while TTS plays: that capture is a barge-in monitor whose
    // echo-filled audio is discarded, never worth transcribing.
  } = useDictation(handleTranscript, { partials: !tts.isPlaying });

  const { vadSensitivity, voiceName, voiceColorsEnabled } = useSettingsStore(
    useShallow((state) => ({
      vadSensitivity: state.dictation.vadSensitivity,
      voiceName: state.tts.supertonic.voiceName,
      voiceColorsEnabled: state.tts.voiceColorsEnabled,
    })),
  );
  const hasError =
    sessionError || Boolean(dictationError) || (ttsAttempted && Boolean(tts.error));

  const handleTypedSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const value = draft.trim();
      if (!value) return;
      if (!canSubmit) {
        setSessionError(true);
        return;
      }
      await cancel();
      tts.actions.stop();
      setLastHeard(value);
      rememberCurrentResponses();
      setDraft("");
      try {
        await onSubmit(value);
      } catch {
        setAwaitingResponse(false);
        setSessionError(true);
      }
    },
    [canSubmit, cancel, draft, onSubmit, rememberCurrentResponses, tts.actions],
  );

  const handleOrbClick = useCallback(() => {
    if (hasError) {
      // Tap to retry: errors latch so a failure can't loop the mic, but they
      // shouldn't silently end the hands-free session. Clearing them lets the
      // auto-start effect reopen a clean turn.
      clearError();
      setSessionError(false);
      setTtsAttempted(false);
      return;
    }
    onToggleCompact();
  }, [clearError, hasError, onToggleCompact]);

  const handleMute = useCallback(() => {
    if (muted) {
      setMuted(false);
      setSessionError(false);
      return;
    }
    setMuted(true);
    void cancel();
  }, [cancel, muted]);

  const handleClose = useCallback(() => {
    void cancel();
    tts.actions.stop();
    onClose();
  }, [cancel, onClose, tts.actions]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    inputRef.current?.focus();
    // Warm both speech models so the first turn doesn't pay load latency.
    void invoke("preload_whisper_model").catch(() => {});
    void warmTtsEngine();
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [handleClose, open]);

  useEffect(() => {
    if (!recording) return;
    vadStateRef.current = createVoiceActivityState(Date.now());
    bargeInStateRef.current = createBargeInState(Date.now());
    vadStoppingRef.current = false;
  }, [recording]);

  useEffect(() => {
    if (!recording || vadStoppingRef.current) return;

    if (monitoringRef.current) {
      // Assistant is speaking; only watch for the user talking over it. Mic
      // level that tracks the playback output level is our own echo; level
      // that stands clear of it is the user.
      const result = advanceBargeIn(
        bargeInStateRef.current,
        audioLevel,
        tts.outputLevel,
        Date.now(),
      );
      bargeInStateRef.current = result.state;
      if (result.shouldInterrupt) {
        vadStoppingRef.current = true;
        monitoringRef.current = false;
        tts.actions.stop();
        onInterrupt?.();
        setAwaitingResponse(false);
        // Discard the echo-filled capture; auto-start opens a clean turn.
        // ponytail: the interjection's first ~0.4s is lost to detection +
        // restart; pre-roll trimming would need echo cancellation first.
        void cancel();
      }
      return;
    }

    const result = advanceVoiceActivity(
      vadStateRef.current,
      audioLevel,
      Date.now(),
      vadSensitivity,
    );
    vadStateRef.current = result.state;
    if (result.shouldStop) {
      vadStoppingRef.current = true;
      void stop();
    }
  }, [audioLevel, cancel, onInterrupt, recording, stop, tts.actions, tts.outputLevel, vadSensitivity]);

  // Playback ended while the mic was only monitoring for barge-in — discard
  // that capture so the next turn starts clean.
  useEffect(() => {
    if (tts.isPlaying || !monitoringRef.current) return;
    monitoringRef.current = false;
    if (recording) void cancel();
  }, [cancel, recording, tts.isPlaying]);

  // Speak the reply while it streams: flush completed sentences to TTS as
  // they arrive instead of waiting for the full response.
  useEffect(() => {
    if (!awaitingResponse) return;
    const response = messages.find(
      (message) =>
        message.role === "assistant" &&
        !assistantIdsBeforeSend.current.has(message.id) &&
        (pipelineIdRef.current === null || message.id === pipelineIdRef.current),
    );
    if (!response) return;

    if (pipelineIdRef.current === null) {
      pipelineIdRef.current = response.id;
      spokenCharsRef.current = 0;
      setTtsAttempted(true);
      tts.actions.beginUtterance(response.id);
    }

    if (response.status === "error") {
      tts.actions.stop();
      setAwaitingResponse(false);
      setSessionError(true);
      return;
    }
    if (response.status === "aborted") {
      tts.actions.stop();
      setAwaitingResponse(false);
      return;
    }

    const content = response.content ?? "";
    if (response.status === "complete") {
      const rest = content.slice(spokenCharsRef.current);
      spokenCharsRef.current = content.length;
      if (rest.trim()) void tts.actions.speakChunk(rest);
      tts.actions.endUtterance();
      setAwaitingResponse(false);
      if (!content.trim()) setSessionError(true);
      return;
    }

    const pending = content.slice(spokenCharsRef.current);
    const flushable = speakableSentencePrefix(pending);
    if (flushable) {
      spokenCharsRef.current += flushable.length;
      void tts.actions.speakChunk(flushable);
    }
  }, [awaitingResponse, messages, tts.actions]);

  const [autoStartTick, setAutoStartTick] = useState(0);
  const playbackEndedAtRef = useRef(0);

  // Cue the mic opening for a real turn (not the discarded barge-in monitor)
  // so eyes-free use doesn't depend on watching the orb.
  useEffect(() => {
    if (recording && !monitoringRef.current) playMicCue();
  }, [recording]);

  useEffect(() => {
    if (!tts.isPlaying) return;
    return () => {
      playbackEndedAtRef.current = Date.now();
    };
  }, [tts.isPlaying]);

  // Retry start() every 5 seconds while the overlay is open but the mic
  // hasn't started. start() is single-flight, so retries are no-ops while a
  // start is still in flight and only recover from failed attempts.
  useEffect(() => {
    if (!open || recording || processing || muted || hasError || installOpen) return;
    const timer = setTimeout(() => setAutoStartTick((t) => t + 1), 5000);
    return () => clearTimeout(timer);
  }, [open, recording, processing, muted, hasError, installOpen, autoStartTick]);

  useEffect(() => {
    const ready =
      open && !muted && !recording && !processing && !installOpen && !hasError;
    const fullyIdle =
      !awaitingResponse && !isResponding && !tts.isGenerating && !tts.isPlaying;
    // Capture runs in two modes: a normal turn when idle, or a barge-in
    // monitor while the assistant is speaking.
    if (!ready || !(fullyIdle || tts.isPlaying)) return;
    if (!tts.isPlaying) {
      // Echo guard: let the speaker tail die down before opening a real turn,
      // or Whisper transcribes the end of the assistant's own reply.
      const sincePlayback = Date.now() - playbackEndedAtRef.current;
      if (sincePlayback < PLAYBACK_ECHO_GRACE_MS) {
        const timer = setTimeout(
          () => setAutoStartTick((tick) => tick + 1),
          PLAYBACK_ECHO_GRACE_MS - sincePlayback,
        );
        return () => clearTimeout(timer);
      }
    }
    monitoringRef.current = tts.isPlaying;
    void start();
  }, [
    awaitingResponse,
    hasError,
    installOpen,
    isResponding,
    muted,
    open,
    processing,
    recording,
    start,
    tts.isGenerating,
    tts.isPlaying,
    autoStartTick,
  ]);

  useEffect(
    () => () => {
      void cancel();
      tts.actions.stop();
    },
    [cancel, tts.actions],
  );

  if (!open) return null;

  const orbState: HeroOrbState = hasError
      ? "error"
      : tts.isPlaying
        ? "live"
        : processing || awaitingResponse || isResponding || tts.isGenerating
          ? "connecting"
          : "idle";
  const visualOrbState: HeroOrbState = orbState === "error" ? orbState : "idle";
  // While listening (or finalizing) show the live partial transcript; once
  // the turn is submitted, show what was heard until the reply finishes.
  const livePartial =
    !hasError &&
    partialTranscript &&
    ((recording && !monitoringRef.current) || processing)
      ? partialTranscript
      : "";
  const caption =
    livePartial ||
    (!hasError &&
    lastHeard &&
    (tts.isPlaying || processing || awaitingResponse || isResponding || tts.isGenerating)
      ? lastHeard
      : "");
  const combinedAudioLevel = Math.max(audioLevel, tts.outputLevel);
  const statusText = hasError
      ? "Something went wrong — tap the orb to retry"
      : tts.isPlaying
        ? "Speaking"
        : processing || awaitingResponse || isResponding || tts.isGenerating
          ? "Thinking…"
          : muted
            ? "Muted"
            : recording
              ? "Listening"
              : "Starting…";
  const downloadPercent =
    downloadProgress?.totalBytes && downloadProgress.totalBytes > 0
      ? Math.round(
          (downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100,
        )
      : null;

  return (
    <>
        <div
          role="dialog"
          aria-modal={compact ? undefined : "true"}
          aria-label="Voice mode"
          className={`absolute inset-0 z-20 text-foreground transition-opacity duration-200 ${entered ? "opacity-100" : "opacity-0"} ${compact ? "pointer-events-none" : "bg-background"}`}
        >
          {/* The orb keeps its 180px canvas; docking animates position and
              scale so the shader surface never remounts mid-transition. */}
          <div
            className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out ${
              compact ? "top-[calc(100%-135px)] scale-[0.35]" : "top-[40%] scale-100"
            }`}
          >
            <button
              type="button"
              onClick={handleOrbClick}
              aria-label={
                hasError
                    ? "Retry voice mode"
                    : compact
                      ? "Expand voice mode"
                      : "Shrink voice mode"
              }
              className="block cursor-pointer border-0 bg-transparent p-0"
            >
              <HeroOrb
                state={visualOrbState}
                size={180}
                audioLevel={combinedAudioLevel}
                palette={getVoiceOrbPalette(voiceName, visualOrbState, voiceColorsEnabled)}
              />
            </button>
            {compact ? null : (
              <>
                <p
                  aria-live="polite"
                  className="absolute top-full left-1/2 mt-4 -translate-x-1/2 text-sm whitespace-nowrap text-muted-foreground"
                >
                  {statusText}
                </p>
                {caption ? (
                  <p className="absolute top-full left-1/2 mt-12 line-clamp-2 w-[32rem] max-w-[80vw] -translate-x-1/2 text-center text-xs text-muted-foreground/60">
                    “{caption}”
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="pointer-events-auto absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-5">
            <form
              className="flex h-12 w-full max-w-2xl items-center gap-1 rounded-full bg-secondary p-1 pl-2"
              onSubmit={handleTypedSubmit}
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Add attachment"
                className="size-9 rounded-full text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Plus />
              </Button>
              <InputBase
                inputRef={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type"
                aria-label="Voice mode message"
                className="h-full flex-1 text-base text-foreground placeholder:text-muted-foreground"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleMute}
                aria-pressed={muted}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                className="size-9 rounded-full text-foreground hover:bg-accent hover:text-accent-foreground"
              >
                {muted ? <MicOff /> : <Mic />}
              </Button>
              <Button
                type="button"
                size="icon"
                onClick={handleClose}
                aria-label="Close voice mode"
                className="size-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/85"
              >
                <X />
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground/60">
              Poly can make mistakes. Check important info.
            </p>
          </div>
        </div>
      <DictationModelDialog
        open={installOpen}
        models={models}
        selectedModelId={selectedModelId}
        installingModelId={installingModelId}
        downloadPercent={downloadPercent}
        onClose={() => {
          setMuted(true);
          closeInstall();
        }}
        onInstall={installModel}
        onSelect={selectInstalledModel}
      />
    </>
  );
}
