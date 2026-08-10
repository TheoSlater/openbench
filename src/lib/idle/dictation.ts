import { invoke } from '@/lib/tauriBridge'
import { idleManager } from './manager'
import { useNotificationStore } from '@/store/notificationStore'

let selectedModelId: string | null = null
let unregister: (() => void) | null = null
let released = false

export async function registerDictationOffload(): Promise<void> {
  if (unregister) return
  try {
    const status = await invoke<{ selectedModelId: string | null }>('get_whisper_models_status')
    selectedModelId = status.selectedModelId
  } catch {
    return
  }
  unregister = idleManager.register('dictation-model', {
    onPause: () => { release() },
    onResume: () => { reload() },
    priority: 100,
  })
}

export function unregisterDictationOffload(): void {
  unregister?.()
  unregister = null
}

async function release(): Promise<void> {
  if (released) return
  released = true
  try { await invoke('release_whisper_model') } catch {}
}

async function reload(): Promise<void> {
  if (!released) return
  released = false
  if (!selectedModelId) {
    try {
      const status = await invoke<{ selectedModelId: string | null }>('get_whisper_models_status')
      selectedModelId = status.selectedModelId
    } catch { return }
  }
  if (selectedModelId) {
    try {
      await invoke('select_whisper_model', { modelId: selectedModelId })
    } catch {
      useNotificationStore.getState().actions.add({
        type: 'warning',
        message: 'Dictation model failed to reload',
        description: 'Reselect it in Settings → Dictation if voice input stops working.',
        duration: 5000,
      })
    }
  }
}
