import { devLog } from '@/features/debug-overlay/devLog'

type IdleState = 'active' | 'idle'
type StateListener = (state: IdleState) => void

interface IdleHandler {
  onPause: () => void
  onResume: () => void
  priority?: number
}

const ACTIVITY_EVENTS = [
  'mousedown', 'keydown', 'touchstart', 'touchmove',
  'scroll', 'wheel',
] as const

const MOUSEMOVE_THROTTLE_MS = 30000
const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000

class IdleStateManager {
  private _state: IdleState = 'active'
  private handlers = new Map<string, IdleHandler>()
  private stateListeners = new Set<StateListener>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private _timeout: number = DEFAULT_IDLE_TIMEOUT
  private idleBlocked = 0
  private pendingIdle = false
  private _started = false
  private _cleanups: (() => void)[] | null = null
  private lastMousemove = 0

  get state() { return this._state }
  get started() { return this._started }
  get isIdle() { return this._state === 'idle' }

  register(id: string, handler: IdleHandler): () => void {
    this.handlers.set(id, handler)
    return () => { this.handlers.delete(id) }
  }

  unregister(id: string): void {
    this.handlers.delete(id)
  }

  onStateChange(fn: StateListener): () => void {
    this.stateListeners.add(fn)
    return () => { this.stateListeners.delete(fn) }
  }

  blockIdle(): () => void {
    this.idleBlocked++
    this.pendingIdle = false
    let released = false
    return () => {
      if (released) return
      released = true
      this.idleBlocked = Math.max(0, this.idleBlocked - 1)
      if (this.idleBlocked === 0 && this.pendingIdle) {
        this.pendingIdle = false
        this.enterIdle()
      }
    }
  }

  forceIdle(): void {
    this.clearTimer()
    this.pendingIdle = false
    this.idleBlocked = 0
    this.enterIdle()
  }

  forceActive(): void {
    this.clearTimer()
    this.pendingIdle = false
    this.exitIdle()
    this.resetTimer()
  }

  setTimeout(ms: number): void {
    this._timeout = ms
    if (this._started && this._state === 'active') {
      this.resetTimer()
    }
  }

  start(): void {
    if (this._started) return
    this._started = true
    const cleanups: (() => void)[] = []

    const add = (target: EventTarget, evt: string, fn: EventListener) => {
      target.addEventListener(evt, fn, { passive: true })
      cleanups.push(() => target.removeEventListener(evt, fn))
    }

    for (const evt of ACTIVITY_EVENTS) {
      add(window, evt, this.onActivity)
    }
    add(window, 'mousemove', this.onMousemove)
    add(document, 'visibilitychange', this.onVisibility)
    add(window, 'focus', this.onFocus)
    add(window, 'blur', this.onBlur)

    this._cleanups = cleanups
    this.resetTimer()
  }

  stop(): void {
    if (!this._started) return
    this._started = false

    if (this._cleanups) {
      for (const cleanup of this._cleanups) cleanup()
      this._cleanups = null
    }

    this.clearTimer()
    this.pendingIdle = false

    if (this._state === 'idle') {
      this._state = 'active'
      this.notifyState()
      for (const h of this.handlers.values()) h.onResume()
    }
  }

  destroy(): void {
    this.stop()
    this.handlers.clear()
    this.stateListeners.clear()
    this.idleBlocked = 0
  }

  private onActivity = () => {
    if (this._state === 'idle') this.exitIdle()
    this.resetTimer()
  }

  private onMousemove = () => {
    const now = Date.now()
    if (now - this.lastMousemove < MOUSEMOVE_THROTTLE_MS) return
    this.lastMousemove = now
    this.onActivity()
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') {
      if (this._state === 'idle') this.exitIdle()
      this.resetTimer()
    }
  }

  private onFocus = () => {
    if (this._state === 'idle') this.exitIdle()
    this.resetTimer()
  }

  private onBlur = () => {}

  private resetTimer(): void {
    this.clearTimer()
    if (!this._started) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.tryEnterIdle()
    }, this._timeout)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tryEnterIdle(): void {
    if (this.idleBlocked > 0) {
      this.pendingIdle = true
      return
    }
    this.enterIdle()
  }

  private enterIdle(): void {
    if (this._state === 'idle') return
    this.pendingIdle = false
    this._state = 'idle'
    this.notifyState()
    const count = this.handlers.size
    devLog('debug', 'idle', 'Idle state entered', { handlerCount: count })
    const sorted = [...this.handlers.entries()]
      .sort((a, b) => (b[1].priority ?? 0) - (a[1].priority ?? 0))
    for (const [, h] of sorted) h.onPause()
  }

  private exitIdle(): void {
    if (this._state !== 'idle') return
    this._state = 'active'
    this.notifyState()
    devLog('debug', 'idle', 'Active state restored')
    const sorted = [...this.handlers.entries()]
      .sort((a, b) => (a[1].priority ?? 0) - (b[1].priority ?? 0))
    for (const [, h] of sorted) h.onResume()
  }

  private notifyState(): void {
    for (const fn of this.stateListeners) fn(this._state)
  }
}

export const idleManager = new IdleStateManager()
export type { IdleState, IdleHandler, StateListener }
