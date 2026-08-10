import { invoke } from '@/lib/tauriBridge'
import { idleManager } from './manager'
import { startUpdateChecker, stopUpdateChecker } from '@/store/updateStore'
import { useTtsStore } from '@/store/ttsStore'
import { registerDictationOffload } from './dictation'
import { registerMemoryPurge } from './purge'

export function registerDefaultIdleHandlers(): void {
  idleManager.register('update-checker', {
    onPause: () => stopUpdateChecker(),
    onResume: () => startUpdateChecker(),
    priority: 5,
  })

  // Drop the Supertonic TTS engine's RAM after inactivity. No eager reload on
  // resume: ensureSupertonicLoaded lazily reloads before the next utterance,
  // and voice mode warms it on open.
  idleManager.register('tts-engine', {
    onPause: () => {
      const { isPlaying, isGenerating } = useTtsStore.getState()
      if (isPlaying || isGenerating) return
      void invoke('release_tts_engine').catch(() => {})
    },
    onResume: () => {},
    priority: 100,
  })

  registerDictationOffload()
  registerMemoryPurge()
}
