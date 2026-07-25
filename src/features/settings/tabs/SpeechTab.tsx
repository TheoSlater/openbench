import { useCallback, useEffect, useState, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Square,
  Volume2,
} from "lucide-react";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CircularProgress } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Stack } from "@/components/ui/Stack";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/Typography";
import { SettingCard, SectionHeader, selectClassName } from "../SettingComponents";
import { useSettingsStore } from "@/store/settingsStore";
import { useTtsStore } from "@/store/ttsStore";
import { useNotify } from "@/hooks/useNotify";
import { useDictation } from "@/hooks/useDictation";
import { DictationModelDialog } from "@/features/dictation/DictationModelDialog";
import HeroOrb from "@/features/chat/components/HeroOrb";
import { getVoiceOrbPalette } from "@/features/chat/voicePalettes";

const VOICE_PROFILES = [
  { id: "M1", name: "Alex", description: "Open and upbeat", levels: "AAAAAAAAAAABA3j//6xA/80MQ6j/iAwGDQYDAgMCbv///7KCNP+Tmn+cPyMZH0aXuFIUCwMBAAAAAQAAAAAAAAAA" },
  { id: "F1", name: "Sarah", description: "Bright and expressive", levels: "AAAAAAAAAAEBJLG7wZ1fIwIBAwQGBAWFwAVAdOW6BgcGKbr/0dCFhX/K/P3MvbzauYVKAgEAAAAAAAAAAAAAAAA=" },
  { id: "M2", name: "James", description: "Calm and grounded", levels: "AAAAAAAAAAAAAAEI///3Z6F9MBcNAgEBAgIDAhj6/60HnP8hKYzQayoUDQEBAQEBAAACuf+JA3P9///YcIT/7Qwar5ESBgEAAAAAAAAAAAAAAA==" },
  { id: "F2", name: "Lily", description: "Warm and thoughtful", levels: "AAAAAAAAAAAAAAYW//CuSREDBBD//7WrqtoVXJtJTGk+sNeeWkkxCQUBAQEAAAAAAAAAAAAA" },
  { id: "M3", name: "Robert", description: "Confident and direct", levels: "AAAAAAAAAAAWwcSrk5N2PQkBAQFR/ztt6ak+T0P3mzNPkbJ7RwsBAQGi19J7lElrpKGkWV49KAMBAQAAAAAAAAAA" },
  { id: "F3", name: "Jessica", description: "Clear and composed", levels: "AAAAAAAAAAABAgdLzph5cGpZST03JQECBAMDAwMUotd/BIqkSHuvgXqVggoDLoFRZ5t/JQ0JCTZ+jnhhTTcBAQEAAAAAAAA=" },
  { id: "M4", name: "Sam", description: "Easygoing and natural", levels: "AAAAAAAAAAABD/L/+pA1BwEBAg2K+eNOhBICj86/qXlTLQYMnf3U2OeYi++lDGi7knZhSDILAQEAAAAAAAAAAA==" },
  { id: "F4", name: "Olivia", description: "Measured and reassuring", levels: "AAAAAAAAAAEVm728QMrTxsmoSwgBW621ZMP/4YzApchBxHarqEXTs1VoR1ExAQEBAAAAAAAAAAA=" },
  { id: "M5", name: "Daniel", description: "Deep and reflective", levels: "AAAAAAAAAAAAABL//2sXTci/P///8p4iHda018imlW9LOhEEAQEBAQEBASj/2aVegKl8OLXkjXDWSzv/uIaGgF4TAgEAAAAAAAAAAAA=" },
  { id: "F5", name: "Emily", description: "Friendly and energetic", levels: "AAAAAAAAAAEiUrzq/8uYTgYBAQECAgL/r2M4k9VSY/Pev69oAwICAqH/GErY/3saTXriowua0nUNhsu9qaR7EwEBAAAAAAAAAAA=" },
] as const;

const WHISPER_LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
];

export function SpeechTab() {
  const { general, tts, dictation, actions } = useSettingsStore(
    useShallow((state) => ({
      general: state.general,
      tts: state.tts,
      dictation: state.dictation,
      actions: state.actions,
    })),
  );
  const ttsPlayback = useTtsStore(
    useShallow((state) => ({
      activeMessageId: state.activeMessageId,
      isPlaying: state.isPlaying,
      isGenerating: state.isGenerating,
      error: state.error,
      actions: state.actions,
    })),
  );
  const notify = useNotify();

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supertonicVoices, setSupertonicVoices] = useState<string[]>([]);
  const [supertonicLoading, setSupertonicLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [previewAudioLevel, setPreviewAudioLevel] = useState(0);
  const shownErrorsRef = useRef<Set<string>>(new Set());
  const swipeStartX = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewMeterFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSpeechSupported(false);
      return;
    }

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const usesSupertonicControls = tts.engine === "supertonic" || (tts.engine === "auto" && !speechSupported);
  const usesNativeControls = tts.engine === "native" || (tts.engine === "auto" && speechSupported);

  useEffect(() => {
    if (!usesSupertonicControls || supertonicVoices.length > 0 || supertonicLoading) return;

    setSupertonicLoading(true);
    const onProgress = new Channel<{ stage: string; progress?: number }>();
    const loadPromise = invoke("plugin:supertonic|load_model", {
      modelId: "Supertone/supertonic-3",
      voiceStyle: tts.supertonic.voiceName,
      onProgress,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Supertonic model download timed out after 120 s")), 120_000),
    );

    void Promise.race([loadPromise, timeoutPromise])
      .then(() => invoke<string[]>("plugin:supertonic|list_voices"))
      .then(setSupertonicVoices)
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Could not load Supertonic voices.";
        notify.error("Speech error", message);
      })
      .finally(() => setSupertonicLoading(false));
  }, [notify, supertonicLoading, supertonicVoices.length, tts.supertonic.voiceName, usesSupertonicControls]);

  useEffect(() => {
    if (ttsPlayback.error && !shownErrorsRef.current.has(ttsPlayback.error)) {
      shownErrorsRef.current.add(ttsPlayback.error);
      notify.error("Speech error", ttsPlayback.error);
    }
  }, [ttsPlayback.error, notify]);

  const teardownVoicePreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.onended = null;
      previewAudioRef.current.onerror = null;
      previewAudioRef.current.pause();
      if (previewAudioRef.current.src.startsWith("blob:")) {
        URL.revokeObjectURL(previewAudioRef.current.src);
      }
      previewAudioRef.current = null;
    }
    if (previewMeterFrameRef.current !== null) {
      cancelAnimationFrame(previewMeterFrameRef.current);
      previewMeterFrameRef.current = null;
    }
  }, []);

  const stopVoicePreview = useCallback(() => {
    teardownVoicePreview();
    setPreviewAudioLevel(0);
  }, [teardownVoicePreview]);

  useEffect(() => teardownVoicePreview, [teardownVoicePreview]);

  const handleTestSpeech = async () => {
    const testId = "test-synthesis";
    if (ttsPlayback.activeMessageId === testId && ttsPlayback.isPlaying) {
      ttsPlayback.actions.stop();
      return;
    }

    await ttsPlayback.actions.play(
      testId,
      "Speech synthesis is active and configured correctly.",
    );
  };

  const isTesting = ttsPlayback.activeMessageId === "test-synthesis";
  const isDisabled = ttsPlayback.isGenerating && !isTesting;

  const appendTranscript = useCallback(() => {}, []);
  const {
    models,
    selectedModelId,
    installingModelId,
    downloadProgress,
    installOpen,
    closeInstall,
    installModel,
    selectInstalledModel,
    refreshModels,
  } = useDictation(appendTranscript);

  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    if (manageOpen) {
      void refreshModels();
    }
  }, [manageOpen, refreshModels]);

  const downloadPercent =
    downloadProgress?.totalBytes && downloadProgress.totalBytes > 0
      ? Math.round(
          (downloadProgress.downloadedBytes / downloadProgress.totalBytes) *
            100,
        )
      : null;

  const currentModel = models.find((m) => m.id === selectedModelId);
  const availableProfiles = VOICE_PROFILES.filter(
    (profile) => supertonicVoices.length === 0 || supertonicVoices.includes(profile.id),
  );
  const selectedVoiceIndex = Math.max(
    0,
    availableProfiles.findIndex((profile) => profile.id === tts.supertonic.voiceName),
  );
  const selectedVoice = availableProfiles[selectedVoiceIndex] ?? VOICE_PROFILES[0];
  const selectVoice = (index: number) => {
    const profile = availableProfiles[(index + availableProfiles.length) % availableProfiles.length];
    if (!profile) return;
    stopVoicePreview();
    const audio = new Audio();
    const levels = Uint8Array.from(atob(profile.levels), (value) => value.charCodeAt(0));
    const meter = () => {
      if (previewAudioRef.current !== audio) return;
      const index = Math.min(levels.length - 1, Math.floor(audio.currentTime * 20));
      setPreviewAudioLevel((levels[index] ?? 0) / 2550);
      previewMeterFrameRef.current = requestAnimationFrame(meter);
    };
    previewAudioRef.current = audio;
    audio.onended = stopVoicePreview;
    audio.onerror = stopVoicePreview;
    // WebKitGTK can't stream media over Tauri's custom protocol in prod builds,
    // so fetch the file and play it from a blob URL instead of setting src directly.
    void fetch(`voice-previews/${profile.id}.wav`)
      .then((response) => {
        if (!response.ok) throw new Error(`preview fetch failed: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (previewAudioRef.current !== audio) return;
        audio.src = URL.createObjectURL(blob);
        return audio.play().then(meter);
      })
      .catch(stopVoicePreview);
    actions.updateTts({
      engine: "supertonic",
      supertonic: { ...tts.supertonic, voiceName: profile.id },
    });
  };
  const moveVoice = (direction: number) => selectVoice(selectedVoiceIndex + direction);

  return (
    <Stack spacing={2}>
      <div
        role="listbox"
        aria-label="AI voice"
        aria-activedescendant={`voice-${selectedVoice.id}`}
        tabIndex={0}
        className="touch-pan-y select-none border-b border-border/60 pb-6 pt-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveVoice(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveVoice(1);
          }
        }}
        onPointerDown={(event) => {
          swipeStartX.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (swipeStartX.current === null) return;
          const distance = event.clientX - swipeStartX.current;
          swipeStartX.current = null;
          if (Math.abs(distance) >= 40) moveVoice(distance < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipeStartX.current = null;
        }}
      >
        <div className="flex flex-col items-center text-center">
          <HeroOrb
            state="idle"
            size={190}
            audioLevel={previewAudioLevel}
            palette={getVoiceOrbPalette(selectedVoice.id, "idle", tts.voiceColorsEnabled)}
            className="my-1 max-h-[190px] max-w-[190px]"
          />
          <div className="mt-3 grid w-full grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Previous voice"
              onClick={() => moveVoice(-1)}
            >
              <ChevronLeft />
            </Button>
            <div id={`voice-${selectedVoice.id}`} role="option" aria-selected="true">
              <h3 className="text-2xl font-semibold tracking-tight">{selectedVoice.name}</h3>
              <p className="mt-1 text-base text-muted-foreground">{selectedVoice.description}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              aria-label="Next voice"
              onClick={() => moveVoice(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2" aria-label="Voice choices">
            {availableProfiles.map((profile, index) => (
              <button
                key={profile.id}
                type="button"
                aria-label={`Choose ${profile.name}`}
                aria-current={profile.id === selectedVoice.id ? "true" : undefined}
                className="size-2.5 rounded-full bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/60 aria-current:bg-foreground"
                onClick={() => selectVoice(index)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Swipe or use arrow keys to change voice</p>
        </div>
      </div>

      <SettingCard
        title="Voice mode"
        description="Open a hands-free AI voice conversation from an empty chat."
        action={
          <Switch
            checked={general.voiceModeExperimental}
            onCheckedChange={(checked) => actions.updateGeneral({ voiceModeExperimental: checked })}
          />
        }
      />

      <SettingCard
        title="Individual voice colours"
        description="Give each AI voice its own orb colour palette. Error, warning, and unavailable states keep their standard colours."
        action={
          <Switch
            checked={tts.voiceColorsEnabled}
            onCheckedChange={(checked) => actions.updateTts({ voiceColorsEnabled: checked })}
          />
        }
      />

      <SettingCard
        title="Speech Engine"
        description="Choose the voice engine for reading messages."
        action={
          <Select
            value={tts.engine}
            onValueChange={(value) =>
              actions.updateTts({ engine: value as typeof tts.engine })
            }
          >
            <SelectTrigger size="sm" className={selectClassName}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="native">Native</SelectItem>
                <SelectItem value="supertonic">Supertonic</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />

      {!speechSupported ? (
        <Box
        >
          <AlertCircle size={18} />
          <Typography variant="body2">
            Native speech synthesis is unavailable. Supertonic will be used instead.
          </Typography>
        </Box>
      ) : null}

      {usesNativeControls ? (
        <>
          <SettingCard
            title="Native Voice"
            description="Select the system voice to use for reading messages."
            action={
              <Select
                value={tts.browser.voiceURI || (voices[0]?.voiceURI ?? "")}
                disabled={voices.length === 0}
                onValueChange={(value) =>
                  actions.updateTts({
                    browser: {
                      ...tts.browser,
                      voiceURI: value,
                    },
                  })
                }
              >
                <SelectTrigger size="sm" className={selectClassName}>
                  <SelectValue placeholder="Loading voices..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {voices.map((voice) => (
                      <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            }
          />

          <SettingCard title="Playback Speed" description="Adjust the voice reading speed.">
            <Box>
              <Slider
                value={tts.browser.speed}
                min={0.5}
                max={2.0}
                step={0.1}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value.toFixed(1)}x`}
                onChange={(_, value) =>
                  actions.updateTts({
                    browser: { ...tts.browser, speed: value as number },
                  })
                }
              />
              <Typography
              >
                {tts.browser.speed.toFixed(1)}x
              </Typography>
            </Box>
          </SettingCard>

          <SettingCard title="Voice Pitch" description="Adjust the tone of the speaking voice.">
            <Box>
              <Slider
                value={tts.browser.pitch}
                min={0.5}
                max={2.0}
                step={0.1}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value.toFixed(1)}`}
                onChange={(_, value) =>
                  actions.updateTts({
                    browser: { ...tts.browser, pitch: value as number },
                  })
                }
              />
              <Typography
              >
                {tts.browser.pitch.toFixed(1)}
              </Typography>
            </Box>
          </SettingCard>
        </>
      ) : null}

      {usesSupertonicControls ? (
        <>
          <SettingCard title="Supertonic Speed" description="Adjust local voice reading speed.">
            <Box>
              <Slider
                value={tts.supertonic.speed}
                min={0.5}
                max={2.0}
                step={0.1}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value.toFixed(1)}x`}
                onChange={(_, value) =>
                  actions.updateTts({
                    supertonic: { ...tts.supertonic, speed: value as number },
                  })
                }
              />
              <Typography>{tts.supertonic.speed.toFixed(1)}x</Typography>
            </Box>
          </SettingCard>

          <SettingCard title="Supertonic Steps" description="Adjust synthesis detail.">
            <Box>
              <Slider
                value={tts.supertonic.totalStep}
                min={3}
                max={20}
                step={1}
                valueLabelDisplay="auto"
                onChange={(_, value) =>
                  actions.updateTts({
                    supertonic: { ...tts.supertonic, totalStep: value as number },
                  })
                }
              />
              <Typography>{tts.supertonic.totalStep}</Typography>
            </Box>
          </SettingCard>

          <SettingCard title="Supertonic Silence" description="Adjust pause between segments.">
            <Box>
              <Slider
                value={tts.supertonic.silenceDuration}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value.toFixed(2)}s`}
                onChange={(_, value) =>
                  actions.updateTts({
                    supertonic: { ...tts.supertonic, silenceDuration: value as number },
                  })
                }
              />
              <Typography>{tts.supertonic.silenceDuration.toFixed(2)}s</Typography>
            </Box>
          </SettingCard>
        </>
      ) : null}

      <Box>
        <Button
          variant="default"
          onClick={handleTestSpeech}
          disabled={isDisabled}
          startIcon={
            ttsPlayback.isGenerating && isTesting ? (
              <CircularProgress size={16} color="inherit" />
            ) : ttsPlayback.isPlaying && isTesting ? (
              <Square size={16} />
            ) : (
              <Volume2 size={16} />
            )
          }
        >
          {ttsPlayback.isGenerating && isTesting
            ? "Preparing..."
            : ttsPlayback.isPlaying && isTesting
              ? "Stop Test"
              : "Test Voice"}
        </Button>
      </Box>

      <SectionHeader
        title="Dictation"
        description="Local voice dictation using Whisper speech recognition models."
        className="mt-8"
      />

      <SettingCard
        title="Enable dictation"
        description="Show the microphone button in chat input for voice dictation."
        action={
          <Switch
            checked={dictation.enabled}
            onChange={(e) => {
              if (!e.target.checked) {
                void invoke("release_whisper_model");
              }
              actions.updateDictation({ enabled: e.target.checked });
            }}
          />
        }
      />

      {dictation.enabled && (
        <>
          <SettingCard
            title="Language"
            description="Language for speech recognition. Auto-detect defaults to English for reliability."
            action={
              <Select
                value={dictation.language}
                onValueChange={(value) =>
                  actions.updateDictation({ language: value })
                }
              >
                <SelectTrigger size="sm" className={selectClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {WHISPER_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            }
          />

          <SettingCard
            title="Auto-start recording"
            description="Start recording immediately when pressing the mic button, skipping the model selection dialog."
            action={
              <Switch
                checked={dictation.autoStart}
                onChange={(e) => actions.updateDictation({ autoStart: e.target.checked })}
              />
            }
          />

          <SettingCard
            title="Microphone sensitivity"
            description="How easily voice mode detects speech. Raise it if your speech is missed, lower it if background noise triggers turns."
          >
            <Box>
              <Slider
                value={dictation.vadSensitivity ?? 1}
                min={0.5}
                max={2.0}
                step={0.1}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value.toFixed(1)}x`}
                onChange={(_, value) =>
                  actions.updateDictation({ vadSensitivity: value as number })
                }
              />
              <Typography
              >
                {(dictation.vadSensitivity ?? 1).toFixed(1)}x
              </Typography>
            </Box>
          </SettingCard>

          <SettingCard
            title="Model"
            description={
              currentModel
                ? `Currently using ${currentModel.name} (${currentModel.sizeLabel})`
                : "No Whisper model installed. Install one to use dictation."
            }
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setManageOpen(true)}
              >
                {models.length > 0 ? "Manage models" : "Install model"}
              </Button>
            }
          >
            {currentModel && (
              <Box>
                <Chip
                  label={currentModel.speedLabel}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={currentModel.qualityLabel}
                  size="small"
                  variant="outlined"
                />
              </Box>
            )}
          </SettingCard>
        </>
      )}

      <DictationModelDialog
        open={manageOpen || installOpen}
        models={models}
        selectedModelId={selectedModelId}
        installingModelId={installingModelId}
        downloadPercent={downloadPercent}
        onClose={() => {
          setManageOpen(false);
          closeInstall();
        }}
        onInstall={installModel}
        onSelect={selectInstalledModel}
      />
    </Stack>
  );
}
