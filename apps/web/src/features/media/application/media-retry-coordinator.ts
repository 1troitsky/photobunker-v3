import { watch } from 'vue'
import { activeSession } from '../../identity/application/session'
import { flushMediaOutbox, listLocalMedia } from './media-outbox'

/**
 * #390: A camera capture can enqueue encrypted MediaFile chunks without ever
 * mounting the Browser's MediaImportPanel lifecycle. Keep a single bounded,
 * account-scoped retry loop at the app shell instead of depending on a route,
 * an online event, or a manual "sync" button.
 *
 * This is an in-app retry coordinator, NOT a Service Worker or a promise of
 * background delivery while a mobile OS has suspended the PWA.
 */
export const MEDIA_RETRY_IDLE_MS = 15_000
export const MEDIA_RETRY_MAX_MS = 120_000

export function mediaRetryDelayMs(attempt: number): number {
  const safe = Number.isFinite(attempt) ? Math.max(1, Math.min(7, Math.floor(attempt))) : 1
  return Math.min(MEDIA_RETRY_MAX_MS, 5_000 * 2 ** (safe - 1))
}

export function attachMediaRetryCoordinator(): () => void {
  let disposed = false
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  let busy = false
  let wakeRequested = false
  let consecutivePending = 0

  const cancelTimer = () => {
    if (wakeTimer !== null) clearTimeout(wakeTimer)
    wakeTimer = null
  }

  const schedule = (ms: number) => {
    if (disposed) return
    cancelTimer()
    wakeTimer = setTimeout(() => {
      wakeTimer = null
      void run()
    }, ms)
  }

  const run = async () => {
    if (disposed) return
    if (busy) {
      wakeRequested = true
      return
    }
    busy = true
    const session = activeSession.value
    try {
      // Never promote a revoked/locked/offline identity to an online session.
      // The existing outbox itself rechecks identity before every signed call.
      if (!session?.online || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        consecutivePending = 0
        return
      }
      const before = await listLocalMedia()
      if (disposed || activeSession.value !== session) return
      if (before.some(row => row.state === 'queued' || row.state === 'retry')) {
        await flushMediaOutbox()
      }
      if (disposed || activeSession.value !== session) return
      const after = await listLocalMedia()
      if (disposed || activeSession.value !== session) return
      if (after.some(row => row.state === 'queued' || row.state === 'retry')) {
        consecutivePending += 1
        schedule(mediaRetryDelayMs(consecutivePending))
      } else {
        consecutivePending = 0
        schedule(MEDIA_RETRY_IDLE_MS)
      }
    } catch {
      // Do not expose errors, decrypted metadata, Recovery Keys or tokens.
      // A future real signed session transition or timer can safely retry.
      if (!disposed && activeSession.value === session && session?.online) {
        consecutivePending += 1
        schedule(mediaRetryDelayMs(consecutivePending))
      }
    } finally {
      busy = false
      if (disposed) return
      if (activeSession.value !== session) {
        consecutivePending = 0
        wakeRequested = false
        schedule(0)
      } else if (wakeRequested) {
        wakeRequested = false
        schedule(0)
      } else if (wakeTimer === null) {
        schedule(MEDIA_RETRY_IDLE_MS)
      }
    }
  }

  const wake = () => {
    if (disposed) return
    if (busy) {
      wakeRequested = true
      return
    }
    schedule(0)
  }

  const stopSessionWatch = watch(activeSession, () => {
    consecutivePending = 0
    wake()
  }, { flush: 'sync' })
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
  wake()

  return () => {
    disposed = true
    cancelTimer()
    stopSessionWatch()
    window.removeEventListener('online', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}
