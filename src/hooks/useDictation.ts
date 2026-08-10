import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen } from "@/lib/tauriBridge";
import { useSettingsStore } from "@/store/settingsStore";
import { useNotify } from "@/hooks/useNotify";
import { useIdleBlock } from "@/lib/idle";
import { IS_LINUX } from "@/lib/utils/platform";
import {
  DICTATION_SAMPLE_RATE,
  prepareDictationSamples,
  summarizePcm,
} from "@/lib/dictation/audioSamples";

export interface WhisperModelInfo {
  id: string;
  name: string;
  filename: string;
  downloadUrl: string;
  sizeLabel: string;
  speedLabel: string;
  qualityLabel: string;
  description: string;
  recommended: boolean;
  installed: boolean;
}

interface WhisperModelsStatus {
  models: WhisperModelInfo[];
  selectedModelId: string | null;
}

interface WhisperDownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number | null;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const USE_NATIVE_DICTATION =
  IS_LINUX ||
  (typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("linux"));
const DICTATION_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: { ideal: 1 },
    sampleRate: { ideal: DICTATION_SAMPLE_RATE },
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  },
};

function compact(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2_000);
  } catch {
    return String(value);
  }
}

function logDictation(message: string): void {
  void invoke("log_startup_phase", {
    message: `dictation: ${message}`,
  }).catch(() => {});
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listAudioInputs(): Promise<string[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) =>
        `${index}: ${device.label || "(unlabeled)"} deviceId=${device.deviceId || "(empty)"}`,
      );
  } catch (error) {
    return [`enumerateDevices failed: ${String(error)}`];
  }
}

export function useDictation(
  onTranscript: (text: string) => void,
  options?: { partials?: boolean },
) {
  const partialsEnabled = options?.partials ?? false;
  const notify = useNotify();
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  // Speaking into the mic produces no DOM activity events; block idle so the
  // Whisper model isn't released out from under an in-flight capture.
  useIdleBlock(recording || processing);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [installOpen, setInstallOpen] = useState(false);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [installingModelId, setInstallingModelId] = useState<string | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] =
    useState<WhisperDownloadProgress | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const nativeRecordingRef = useRef(false);
  const startInFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const captureGenerationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioInputsRef = useRef<string[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(Date.now());

  const touchActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Errors latch to block auto-restart loops; the UI clears them explicitly
  // when the user asks to retry (e.g. tapping the voice-mode orb).
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    const unlisten = listen<WhisperDownloadProgress>(
      "whisper-model-download-progress",
      (event) => setDownloadProgress(event.payload),
    );

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (recording || processing) return;
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        void invoke("release_whisper_model");
      }
    }, 30_000);

    return () => clearInterval(id);
  }, [recording, processing]);

  const stopAudioMeter = useCallback(() => {
    if (meterIntervalRef.current) clearInterval(meterIntervalRef.current);
    meterIntervalRef.current = null;
    const context = meterContextRef.current;
    meterContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    setAudioLevel(0);
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopAudioMeter();
  }, [stopAudioMeter]);

  useEffect(() => {
    if (!recording || !USE_NATIVE_DICTATION) return;
    let active = true;
    const updateLevel = () => {
      void invoke<number>("native_dictation_audio_level")
        .then((level) => {
          if (active) setAudioLevel(level);
        })
        .catch(() => {
          if (active) setAudioLevel(0);
        });
    };
    updateLevel();
    const interval = setInterval(updateLevel, 100);
    return () => {
      active = false;
      clearInterval(interval);
      setAudioLevel(0);
    };
  }, [recording]);

  // Live transcript while recording: re-transcribe the accumulating native
  // buffer on an interval so the caller can render speech as it happens. The
  // interval only paces attempts — a slow pass just skips ticks (single
  // flight), and the authoritative transcript still comes from stop().
  useEffect(() => {
    if (!recording || !partialsEnabled || !USE_NATIVE_DICTATION) return;
    setPartialTranscript("");
    let active = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const language = useSettingsStore.getState().dictation.language;
        const text = await invoke<string>("transcribe_native_dictation_partial", {
          language: language === "auto" ? null : language,
        });
        if (active && text) setPartialTranscript(text);
      } catch {
        // Partials are best-effort; stop() reports real failures.
      } finally {
        inFlight = false;
      }
    };
    const interval = setInterval(() => void tick(), 750);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [partialsEnabled, recording]);

  const refreshModels = useCallback(async () => {
    const status = await invoke<WhisperModelsStatus>(
      "get_whisper_models_status",
    );
    setModels(status.models);
    setSelectedModelId(status.selectedModelId);
    return status;
  }, []);

  const beginRecording = useCallback(async (generation: number) => {
    if (USE_NATIVE_DICTATION) {
      await invoke("start_native_dictation_recording");
      if (cancelledRef.current || generation !== captureGenerationRef.current) {
        await invoke("stop_native_dictation_recording").catch(() => {});
        return;
      }
      nativeRecordingRef.current = true;
      recordingStartedAtRef.current = Date.now();
      logDictation("native capture start requested");
      setRecording(true);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia(
      DICTATION_AUDIO_CONSTRAINTS,
    );
    if (cancelledRef.current || generation !== captureGenerationRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const meterContext = new AudioContext();
    meterContextRef.current = meterContext;
    await meterContext.resume();
    if (cancelledRef.current || generation !== captureGenerationRef.current) {
      stopTracks();
      return;
    }
    const analyser = meterContext.createAnalyser();
    analyser.fftSize = 1024;
    meterContext.createMediaStreamSource(stream).connect(analyser);
    const meterSamples = new Float32Array(analyser.fftSize);
    meterIntervalRef.current = setInterval(() => {
      analyser.getFloatTimeDomainData(meterSamples);
      let sum = 0;
      for (const sample of meterSamples) sum += sample * sample;
      setAudioLevel(Math.sqrt(sum / meterSamples.length));
    }, 100);
    const track = stream.getAudioTracks()[0] ?? null;
    const audioInputs = await listAudioInputs();
    if (cancelledRef.current || generation !== captureGenerationRef.current) {
      stopTracks();
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    chunksRef.current = [];
    audioInputsRef.current = audioInputs;
    recordingStartedAtRef.current = Date.now();
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.start();
    logDictation(
      `capture start constraints=${compact(DICTATION_AUDIO_CONSTRAINTS.audio)} recorder=${recorder.mimeType || "default"} track_label=${track?.label || "unknown"} track_settings=${compact(track?.getSettings?.() ?? null)} audio_inputs=${compact(audioInputs)}`,
    );
    setRecording(true);
  }, [stopTracks]);

  const start = useCallback(async () => {
    // Single-flight: overlapping start() calls (auto-start effect + retry
    // timer) used to race generations — the stale call's cleanup stopped the
    // shared native recorder out from under the newer one, silently killing
    // an active capture.
    if (startInFlightRef.current || nativeRecordingRef.current || recorderRef.current) {
      return;
    }
    startInFlightRef.current = true;
    const generation = ++captureGenerationRef.current;
    try {
      cancelledRef.current = false;
      setError(null);
      touchActivity();
      const status = await refreshModels();
      if (cancelledRef.current || generation !== captureGenerationRef.current) return;
      if (!status.selectedModelId) {
        setInstallOpen(true);
        return;
      }

      await beginRecording(generation);
    } catch (error) {
      if (generation !== captureGenerationRef.current) return;
      const message = errorText(error);
      setError(message);
      logDictation(`start failed: ${message}`);
      notify.error("Dictation failed", message);
      nativeRecordingRef.current = false;
      recorderRef.current = null;
      stopTracks();
      setRecording(false);
      setProcessing(false);
    } finally {
      startInFlightRef.current = false;
    }
  }, [beginRecording, notify, refreshModels, stopTracks, touchActivity]);

  const closeInstall = useCallback(() => {
    if (!installingModelId) {
      setInstallOpen(false);
    }
  }, [installingModelId]);

  const installModel = useCallback(
    async (modelId: string) => {
      const generation = captureGenerationRef.current;
      touchActivity();
      setInstallingModelId(modelId);
      setDownloadProgress({
        modelId,
        downloadedBytes: 0,
        totalBytes: null,
      });

      try {
        await invoke("download_whisper_model", { modelId });
        await refreshModels();
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        setInstallOpen(false);
        await beginRecording(generation);
      } catch (error) {
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        const message = errorText(error);
        setError(message);
        logDictation(`install/start failed: ${message}`);
        notify.error("Dictation failed", message);
      } finally {
        setInstallingModelId(null);
        setDownloadProgress(null);
      }
    },
    [beginRecording, notify, refreshModels, touchActivity],
  );

  const selectInstalledModel = useCallback(
    async (modelId: string) => {
      const generation = captureGenerationRef.current;
      try {
        touchActivity();
        await invoke("select_whisper_model", { modelId });
        await refreshModels();
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        setInstallOpen(false);
        await beginRecording(generation);
      } catch (error) {
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        const message = errorText(error);
        setError(message);
        logDictation(`select/start failed: ${message}`);
        notify.error("Dictation failed", message);
      }
    },
    [beginRecording, notify, refreshModels, touchActivity],
  );

  const stop = useCallback(async () => {
    const generation = captureGenerationRef.current;
    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false;
      setRecording(false);
      setProcessing(true);

      try {
        const language = useSettingsStore.getState().dictation.language;
        // Single command: stop + transcribe rust-side, so the raw samples
        // never cross IPC. The Rust side logs capture and whisper details.
        const { transcript, peak } = await invoke<{ transcript: string; peak: number }>(
          "stop_native_dictation_and_transcribe",
          { language: language === "auto" ? null : language },
        );
        logDictation(
          `native stop+transcribe elapsed_ms=${Date.now() - recordingStartedAtRef.current} transcript_len=${transcript.length}`,
        );

        if (cancelledRef.current || generation !== captureGenerationRef.current) {
          return;
        }
        if (transcript.trim()) {
          onTranscript(transcript);
        } else {
          notify.warn(
            "No speech detected",
            peak === 0
              ? "The microphone returned silence. Check the selected input device."
              : "Audio was captured, but Whisper returned no text.",
          );
        }
      } catch (error) {
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        const message = errorText(error);
        setError(message);
        logDictation(`native stop/transcribe failed: ${message}`);
        notify.error("Dictation failed", message);
      } finally {
        setProcessing(false);
        touchActivity();
      }
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder) return;

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    if (recorder.state !== "inactive") {
      recorder.stop();
      await stopped;
    }

    recorderRef.current = null;
    setRecording(false);
    setProcessing(true);

    try {
      const chunks = chunksRef.current;
      const chunkSizes = chunks.map((chunk) => chunk.size);
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      const track = streamRef.current?.getAudioTracks()[0] ?? null;
      const trackSettings = track?.getSettings?.() ?? null;
      logDictation(
        `recording stop elapsed_ms=${Date.now() - recordingStartedAtRef.current} chunks=${chunks.length} chunk_sizes=${compact(chunkSizes)} blob_size=${blob.size} blob_type=${blob.type || "unknown"} track_label=${track?.label || "unknown"} track_settings=${compact(trackSettings)}`,
      );

      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(
        await blob.arrayBuffer(),
      );

      try {
        const samples = prepareDictationSamples(audioBuffer);
        const frontendStats = summarizePcm(samples);
        logDictation(
          `decoded source_rate=${audioBuffer.sampleRate} source_channels=${audioBuffer.numberOfChannels} decoded_len=${audioBuffer.length} decoded_duration=${audioBuffer.duration.toFixed(3)} prepared_rate=${DICTATION_SAMPLE_RATE} prepared_len=${samples.length} prepared_stats=${compact(frontendStats)}`,
        );
        const language = useSettingsStore.getState().dictation.language;
        const transcript = await invoke<string>("transcribe_audio", {
          audioSamples: samples,
          language: language === "auto" ? null : language,
          audioMeta: {
            recorderMimeType: recorder.mimeType || null,
            blobType: blob.type || null,
            blobSize: blob.size,
            chunkCount: chunks.length,
            chunkSizes,
            sourceSampleRate: audioBuffer.sampleRate,
            sourceChannelCount: audioBuffer.numberOfChannels,
            decodedLength: audioBuffer.length,
            decodedDurationSeconds: audioBuffer.duration,
            targetSampleRate: DICTATION_SAMPLE_RATE,
            sampleFormat: "float32",
            trackLabel: track?.label || null,
            trackSettings,
            audioInputs: audioInputsRef.current,
            frontendStats,
          },
        });

        if (cancelledRef.current || generation !== captureGenerationRef.current) {
          return;
        }
        if (transcript.trim()) {
          onTranscript(transcript);
        } else {
          const stats = summarizePcm(samples);
          logDictation(`empty transcript browser_stats=${compact(stats)}`);
          notify.warn("No speech detected", "Audio was captured, but Whisper returned no text.");
        }
      } catch (error) {
        if (cancelledRef.current || generation !== captureGenerationRef.current) return;
        const message = errorText(error);
        setError(message);
        logDictation(`browser stop/transcribe failed: ${message}`);
        notify.error("Dictation failed", message);
      } finally {
        await audioContext.close();
      }
    } catch (error) {
      if (cancelledRef.current || generation !== captureGenerationRef.current) return;
      const message = errorText(error);
      setError(message);
      logDictation(`browser stop/transcribe failed: ${message}`);
      notify.error("Dictation failed", message);
    } finally {
      chunksRef.current = [];
      stopTracks();
      setProcessing(false);
      touchActivity();
    }
  }, [notify, onTranscript, stopTracks, touchActivity]);

  const cancel = useCallback(async () => {
    captureGenerationRef.current += 1;
    cancelledRef.current = true;

    if (nativeRecordingRef.current) {
      nativeRecordingRef.current = false;
      try {
        await invoke("stop_native_dictation_recording");
      } catch (error) {
        logDictation(`cancel failed: ${errorText(error)}`);
      }
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.stop();
    }

    chunksRef.current = [];
    stopTracks();
    setRecording(false);
    setInstallOpen(false);
    touchActivity();
  }, [stopTracks, touchActivity]);

  return {
    recording,
    processing,
    partialTranscript,
    error,
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
    refreshModels,
  };
}
