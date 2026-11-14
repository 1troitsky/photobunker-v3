import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { attachMediaRetryCoordinator, mediaRetryDelayMs } from './media-retry-coordinator'

const fake = vi.hoisted(() => ({
  rows: [] as Array<{ state: 'queued' | 'retry' | 'synced' }>,
  flushes: 0,
  recover: false,
}))
vi.mock('./media-outbox', () => ({
  listLocalMedia: vi.fn(async () => fake.rows),
  flushMediaOutbox: vi.fn(async () => {
    fake.flushes += 1
    if (fake.recover) fake.rows = fake.rows.map(() => ({ state: 'synced' as const }))
  }),
}))

let detach: (() => void) | undefined
function account(id: string, online = true): void {
  // Only these fields are consumed by the coordinator; no crypto is mocked
  // into production. All HTTP/ciphertext behavior is covered by real E2E.
  activeSession.value = { accountId: id, online } as Session
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('navigator', { onLine: true })
  fake.rows = []
  fake.flushes = 0
  fake.recover = false
  activeSession.value = null
})
afterEach(() => {
  detach?.()
  detach = undefined
  activeSession.value = null
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('P1 #390 Camera MediaFile bounded retry coordination', () => {
  it('backs off deterministically without unbounded tight retry loops', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 100].map(mediaRetryDelayMs))
      .toEqual([5000, 10000, 20000, 40000, 80000, 120000, 120000, 120000])
    expect(mediaRetryDelayMs(Number.NaN)).toBe(5000)
  })

  it('retries a persistent 503 state without online/visibility events, then stops network calls on ACK', async () => {
    account('A')
    fake.rows = [{ state: 'retry' }]
    detach = attachMediaRetryCoordinator()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.flushes).toBe(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fake.flushes).toBe(1)
    fake.recover = true
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.flushes).toBe(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fake.flushes).toBe(2)
    expect(fake.rows).toEqual([{ state: 'synced' }])
  })

  it('never retries for signed-out or offline account and cleans up on unmount', async () => {
    account('A')
    fake.rows = [{ state: 'retry' }]
    detach = attachMediaRetryCoordinator()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.flushes).toBe(1)
    activeSession.value = null
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.flushes).toBe(1)
    account('B', false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.flushes).toBe(1)
    detach()
    detach = undefined
    account('B', true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.flushes).toBe(1)
  })

  it('requires real navigator connectivity before flushing queued media', async () => {
    account('A')
    fake.rows = [{ state: 'queued' }]
    vi.stubGlobal('navigator', { onLine: false })
    detach = attachMediaRetryCoordinator()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fake.flushes).toBe(0)
    vi.stubGlobal('navigator', { onLine: true })
    ;(window as EventTarget).dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.flushes).toBe(1)
  })
})
