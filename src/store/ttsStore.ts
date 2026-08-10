import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauriBridge";
import { create } from "zustand";
import { devLog } from "@/features/debug-overlay/devLog";

interface TtsState {
  activeMessageId: number | string | null;
  isPlaying: boolean;
  isGenerating: boolean;
  error: string | null;
  outputLevel: number;
  actions: {
    /** Speak one complete text in a single call. */
    play: (messageId: number | string, text: string) => Promise<void>;
    /** Start an incremental utterance; feed it with speakChunk. */
    beginUtterance: (messageId: number | string) => void;
    /** Queue more text onto the current utterance. */
    speakChunk: (text: string) => Promise<void>;
    /** No more chunks; playback state settles when audio drains. */
    endUtterance: () => void;
    stop: () => void;
  };
}

// ponytail: WebKitGTK speechSynthesis (speech-dispatcher) drops or ends
// utterances early on Linux, cutting responses off mid-sentence. Route the
// "auto" engine to Supertonic there; explicit "native" still uses the browser.
const IS_LINUX_WEBVIEW =
  typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("linux");

let supertonicLoadPromise: Promise<void> | null = null;
let supertonicLevelInterval: ReturnType<typeof setInterval> | null = null;
let supertonicAudioContext: AudioContext | null = null;
let browserOutputLevelInterval: ReturnType<typeof setInterval> | null = null;
let ttsSettings = {
  engine: "auto" as "auto" | "native" | "supertonic",
  browser: {
    voiceURI: "",
    speed: 1,
    pitch: 1,
  },
  supertonic: {
    voiceName: "M1",
    speed: 1,
    totalStep: 10,
    silenceDuration: 0.3,
  },
};

export function setTtsBrowserSettings(settings: typeof ttsSettings.browser) {
  ttsSettings.browser = settings;
}

export function setTtsSettings(settings: typeof ttsSettings) {
  ttsSettings = settings;
}

export function cleanTextForSpeech(text: string): string {
  if (!text) return "";

  return text
    .replace(/<[^>]*>/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^\$]+\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Longest prefix of `text` that ends on a sentence boundary and doesn't cut
 * into an unclosed code fence — safe to hand to TTS while the rest is still
 * streaming in.
 */
export function speakableSentencePrefix(text: string): string {
  let searchable = text;
  const fenceParts = text.split("```");
  if (fenceParts.length % 2 === 0) {
    // Odd number of ``` markers — never flush into the unclosed fence, or
    // cleanTextForSpeech can't strip the code block.
    searchable = fenceParts.slice(0, -1).join("```");
  }

  const boundary = /[.!?](?=\s)|\n\n/g;
  let end = -1;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(searchable))) {
    end = match.index + match[0].length;
  }
  return end === -1 ? "" : text.slice(0, end);
}

const getVoice = (voiceURI: string): SpeechSynthesisVoice | undefined => {
  if (!voiceURI) return undefined;
  return window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === voiceURI);
};

const nativeSynthesisAvailable = () =>
  typeof window !== "undefined" && Boolean(window.speechSynthesis);

const usesSupertonic = () =>
  ttsSettings.engine === "supertonic" ||
  (ttsSettings.engine !== "native" && (IS_LINUX_WEBVIEW || !nativeSynthesisAvailable()));

export type TtsLoadProgress =
  | { phase: "start" }
  | { phase: "progress"; file: string; bytesDownloaded: number; totalBytes: number | null }
  | { phase: "done" }
  | { phase: "error"; message: string };

// Injected by store/coordinator.ts (stores must not import each other); the
// notification store turns these into a persistent loading toast.
let notifyLoadProgress: (progress: TtsLoadProgress) => void = () => {};
export function setTtsLoadNotifier(notify: (progress: TtsLoadProgress) => void) {
  notifyLoadProgress = notify;
}

const ensureSupertonicLoaded = async () => {
  const status = await invoke<{ engineLoaded: boolean; currentVoice: string }>("plugin:supertonic|get_status");
  if (status.engineLoaded) {
    if (status.currentVoice !== ttsSettings.supertonic.voiceName) {
      await invoke("plugin:supertonic|select_voice", {
        voiceName: ttsSettings.supertonic.voiceName,
      });
    }
    return;
  }

  supertonicLoadPromise ??= loadSupertonic().finally(() => {
    supertonicLoadPromise = null;
  });
  await supertonicLoadPromise;
};

const loadSupertonic = async () => {
  // A first-time download takes as long as the connection needs, so no hard
  // deadline — instead fail only when nothing has happened for a while.
  let stalled: () => void = () => {};
  const stallPromise = new Promise<never>((_, reject) => {
    stalled = () => reject(new Error("Supertonic model load stalled"));
  });
  let stallTimer = setTimeout(stalled, 120_000);

  const onProgress = new Channel<{
    file: string;
    bytesDownloaded: number;
    totalBytes: number | null;
  }>();
  let progressCount = 0;
  onProgress.onmessage = (p) => {
    progressCount += 1;
    if (progressCount === 1 || progressCount % 10 === 0) {
      devLog("debug", "tts", "Supertonic model load progress", {
        progressCount,
        bytesDownloaded: p.bytesDownloaded,
        hasTotal: p.totalBytes !== null,
      });
    }
    clearTimeout(stallTimer);
    stallTimer = setTimeout(stalled, 120_000);
    notifyLoadProgress({ phase: "progress", ...p });
  };

  notifyLoadProgress({ phase: "start" });
  try {
    await Promise.race([
      invoke("plugin:supertonic|load_model", {
        modelId: "Supertone/supertonic-3",
        voiceStyle: ttsSettings.supertonic.voiceName,
        onProgress,
      }),
      stallPromise,
    ]);
    notifyLoadProgress({ phase: "done" });
  } catch (error) {
    notifyLoadProgress({
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(stallTimer);
  }
};

/** Load the Supertonic engine ahead of the first utterance (e.g. when voice
 * mode opens) so the first reply doesn't pay model-load latency. */
export const warmTtsEngine = async (): Promise<void> => {
  if (!usesSupertonic()) return;
  try {
    await ensureSupertonicLoaded();
  } catch {
    // surfaced on first real playback attempt
  }
};

const clearOutputLevel = () => {
  if (supertonicLevelInterval) { clearInterval(supertonicLevelInterval); supertonicLevelInterval = null; }
  if (browserOutputLevelInterval) { clearInterval(browserOutputLevelInterval); browserOutputLevelInterval = null; }
  if (supertonicAudioContext && supertonicAudioContext.state !== "closed") { void supertonicAudioContext.close(); }
  supertonicAudioContext = null;
};

interface SupertonicChunk {
  pcmBase64: string;
  sampleRate: number;
  durationSecs: number;
  chunkIndex: number;
  isLast: boolean;
}

type SpeechSession = {
  supertonic: boolean;
  ctx: AudioContext | null;
  sink: AudioNode | null;
  scheduledUntil: number;
  pendingSources: number;
  outstandingUtterances: number;
  synthChain: Promise<void>;
  synthBusy: number;
  spokeAnything: boolean;
  finished: boolean;
};

let session: SpeechSession | null = null;

type SetState = (state: Partial<TtsState>) => void;

const settleIfDone = (current: SpeechSession, set: SetState) => {
  if (session !== current || !current.finished) return;
  if (current.synthBusy > 0 || current.pendingSources > 0 || current.outstandingUtterances > 0) {
    return;
  }
  session = null;
  clearOutputLevel();
  set({ outputLevel: 0, isPlaying: false, isGenerating: false, activeMessageId: null });
};

const failSession = (current: SpeechSession, message: string, set: SetState) => {
  if (session !== current) return;
  session = null;
  clearOutputLevel();
  set({
    error: message,
    isPlaying: false,
    isGenerating: false,
    activeMessageId: null,
    outputLevel: 0,
  });
};

const markSpeaking = (current: SpeechSession, set: SetState) => {
  if (current.spokeAnything) return;
  current.spokeAnything = true;
  set({ isGenerating: false, isPlaying: true });
};

const initSessionAudio = (current: SpeechSession, set: SetState) => {
  const ctx = new AudioContext();
  current.ctx = ctx;
  current.sink = ctx.destination;
  supertonicAudioContext = ctx;
  void ctx.resume?.();
  try {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(ctx.destination);
    current.sink = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    supertonicLevelInterval = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const n = (v - 128) / 128;
        sum += n * n;
      }
      set({ outputLevel: Math.sqrt(sum / data.length) });
    }, 100);
  } catch {
    // level meter is optional; playback works without it
  }
};

const synthesizeIntoSession = async (
  current: SpeechSession,
  text: string,
  set: SetState,
) => {
  if (session !== current) return;
  await ensureSupertonicLoaded();
  if (session !== current) return;
  if (!current.ctx) initSessionAudio(current, set);
  const ctx = current.ctx!;
  const sink = current.sink!;

  let resolveLastChunk: () => void = () => {};
  const lastChunkDelivered = new Promise<void>((resolve) => {
    resolveLastChunk = resolve;
  });

  // Chunks arrive as each ~sentence finishes synthesis; schedule them
  // back-to-back on the session AudioContext so speech starts on the first
  // chunk instead of after the whole text is synthesized.
  const onChunk = new Channel<SupertonicChunk>();
  let chunkCount = 0;
  onChunk.onmessage = (chunk) => {
    chunkCount += 1;
    if (chunkCount === 1 || chunk.isLast) {
      devLog("debug", "tts", "Supertonic audio chunk", {
        chunkCount,
        isLast: chunk.isLast,
        sampleRate: chunk.sampleRate,
        sampleCount: chunk.pcmBase64.length,
      });
    }
    if (chunk.isLast) resolveLastChunk();
    if (session !== current || ctx.state === "closed") return;

    const binary = atob(chunk.pcmBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const samples = new Float32Array(bytes.buffer);
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, chunk.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(sink);
    current.pendingSources += 1;
    source.onended = () => {
      current.pendingSources -= 1;
      settleIfDone(current, set);
    };
    const gap = current.spokeAnything ? ttsSettings.supertonic.silenceDuration : 0;
    const startAt = Math.max(ctx.currentTime, current.scheduledUntil + gap);
    source.start(startAt);
    current.scheduledUntil = startAt + buffer.duration;
    markSpeaking(current, set);
  };

  await invoke("plugin:supertonic|synthesize_stream", {
    text,
    lang: "en",
    speed: ttsSettings.supertonic.speed,
    totalStep: ttsSettings.supertonic.totalStep,
    silenceDuration: ttsSettings.supertonic.silenceDuration,
    onChunk,
  });

  // The invoke can resolve before the trailing chunk event is delivered;
  // wait for it (with a safety timeout) before letting the queue advance.
  await Promise.race([
    lastChunkDelivered,
    new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
  ]);
};

const speakBrowserChunk = (current: SpeechSession, cleaned: string, set: SetState) => {
  if (!nativeSynthesisAvailable()) {
    failSession(current, "Speech synthesis is not supported in this environment.", set);
    return;
  }

  const sentences = cleaned
    .split(/[.!?]+\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  if (sentences.length === 0) return;

  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    const voice = getVoice(ttsSettings.browser.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.rate = ttsSettings.browser.speed;
    utterance.pitch = ttsSettings.browser.pitch;
    utterance.onend = () => {
      current.outstandingUtterances -= 1;
      settleIfDone(current, set);
    };
    utterance.onerror = (event) => {
      current.outstandingUtterances -= 1;
      if (event.error !== "interrupted") {
        failSession(current, `Speech synthesis error: ${event.error}`, set);
        return;
      }
      settleIfDone(current, set);
    };
    current.outstandingUtterances += 1;
    window.speechSynthesis.speak(utterance);
  }

  if (!current.spokeAnything) {
    markSpeaking(current, set);
    set({ outputLevel: 0.25 });
    browserOutputLevelInterval = setInterval(() => {
      set({ outputLevel: session === current ? 0.2 + Math.random() * 0.15 : 0 });
    }, 100);
  }
};

export const useTtsStore = create<TtsState>((set, get) => ({
  activeMessageId: null,
  isPlaying: false,
  isGenerating: false,
  error: null,
  outputLevel: 0,
  actions: {
    beginUtterance: (messageId) => {
      get().actions.stop();
      session = {
        supertonic: usesSupertonic(),
        ctx: null,
        sink: null,
        scheduledUntil: 0,
        pendingSources: 0,
        outstandingUtterances: 0,
        synthChain: Promise.resolve(),
        synthBusy: 0,
        spokeAnything: false,
        finished: false,
      };
      set({
        activeMessageId: messageId,
        isPlaying: false,
        isGenerating: true,
        error: null,
        outputLevel: 0,
      });
    },

    speakChunk: async (rawText) => {
      const current = session;
      if (!current) return;
      const cleaned = cleanTextForSpeech(rawText);
      if (!cleaned) {
        settleIfDone(current, set);
        return;
      }

      if (!current.supertonic) {
        speakBrowserChunk(current, cleaned, set);
        return;
      }

      current.synthBusy += 1;
      const run = current.synthChain
        .then(() => synthesizeIntoSession(current, cleaned, set))
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Speech synthesis failed.";
          failSession(current, message, set);
        })
        .finally(() => {
          current.synthBusy -= 1;
          settleIfDone(current, set);
        });
      current.synthChain = run;
      await run;
    },

    endUtterance: () => {
      const current = session;
      if (!current) return;
      current.finished = true;
      settleIfDone(current, set);
    },

    play: async (messageId, rawText) => {
      const actions = get().actions;
      actions.beginUtterance(messageId);
      await actions.speakChunk(rawText);
      actions.endUtterance();
    },

    stop: () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch (err) {
          devLog("warn", "tts", "Error cancelling speech synthesis", err);
        }
      }

      session = null;
      // Closing the AudioContext (clearOutputLevel) halts any scheduled
      // Supertonic chunks; the backend finishes synthesizing but its late
      // chunks are ignored by the dropped-session guard.
      clearOutputLevel();
      set({ activeMessageId: null, isPlaying: false, isGenerating: false, outputLevel: 0 });
    },
  },
}));
