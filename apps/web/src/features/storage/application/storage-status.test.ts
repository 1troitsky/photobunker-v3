import { describe, expect, it } from 'vitest'
import {
  buildEncryptedQueueEntries, filteredEncryptedQueue,
  planManualEncryptedRetry,
  parseServerStorageUsage, summarizeEncryptedQueue,
} from './storage-status'

const asOf = '2026-11-14T15:30:00Z'
const usage = {
  measurement: 'read_only_non_atomic',
  asOfUtc: asOf,
  recordedCipherBytes: 730,
  activeLogicalMediaFiles: 2,
  assignmentsCreatedThisUtcMonth: 1,
  enforcedByteCeiling: 1_000_000_000,
  byteUnitPolicy: 'DECIMAL_GB_TB_V1',
  quotaSource: 'plan_plus_free_technical_guard',
}

describe('real encrypted local queue summary', () => {
  const exp = 2_000_000
  const blob = (bytes: number) => ({ blob: new Blob([new Uint8Array(bytes)]) })

  it('counts genuine ciphertext Blob bytes and separates expired/conflicted/synced', () => {
    expect(summarizeEncryptedQueue([
      { state: 'queued', expiresAt: exp + 10, assets: [blob(120), blob(18)] },
      { state: 'retry', expiresAt: exp + 20, assets: [blob(70)] },
      { state: 'queued', expiresAt: exp, assets: [blob(30)] },
      { state: 'conflict', expiresAt: exp + 10, assets: [blob(40)] },
      { state: 'synced', expiresAt: exp + 10, assets: [blob(99)] },
    ], [
      { state: 'retry', expiresAt: exp + 10, chunks: [blob(11), blob(10)] },
    ], exp)).toEqual({
      pendingCount: 3,
      pendingCipherBytes: 229,
      conflictedCount: 1,
      expiredPendingCount: 1,
      syncedLocalCount: 1,
    })
  })

  it('has zero pending without inventing cloud status', () => {
    expect(summarizeEncryptedQueue([], [], 0)).toEqual({
      pendingCount: 0, pendingCipherBytes: 0, conflictedCount: 0,
      expiredPendingCount: 0, syncedLocalCount: 0,
    })
  })

  it('fails closed on corrupt ciphertext rows and invalid states', () => {
    expect(() => summarizeEncryptedQueue([
      { state: 'queued', expiresAt: 999, assets: [] },
    ], [], 1)).toThrow('storage.invalid_ciphertext_record')
    expect(() => summarizeEncryptedQueue([
      { state: 'retry', expiresAt: 999, assets: [{ blob: null as unknown as Blob }] },
    ], [], 1)).toThrow('storage.invalid_ciphertext_record')
    expect(() => summarizeEncryptedQueue([
      { state: 'unknown' as 'queued', expiresAt: 999, assets: [blob(1)] },
    ], [], 1)).toThrow('storage.invalid_queue_state')
  })
})

describe('authenticated server storage usage is not a quota receipt', () => {
  it('accepts only an explicitly marked non-atomic server measurement', () => {
    expect(parseServerStorageUsage(usage, asOf, 'free')).toEqual({
      planId: 'free',
      asOfUtc: asOf,
      recordedCipherBytes: 730,
      activeLogicalMediaFiles: 2,
      assignmentsCreatedThisUtcMonth: 1,
      enforcedByteCeiling: 1_000_000_000,
      byteUnitPolicy: 'DECIMAL_GB_TB_V1',
    })
  })

  it('rejects client-forged, stale, negative or unbounded snapshots', () => {
    for (const invalid of [
      { ...usage, measurement: 'verified_s3_bytes' },
      { ...usage, asOfUtc: '2026-11-13T15:30:00Z' },
      { ...usage, recordedCipherBytes: -1 },
      { ...usage, recordedCipherBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...usage, activeLogicalMediaFiles: '2' },
      { ...usage, enforcedByteCeiling: null },
      { ...usage, quotaSource: 'client_overridden' },
      { ...usage, byteUnitPolicy: 'unlimited' },
      { ...usage, assignmentsCreatedThisUtcMonth: -1 },
    ]) expect(() => parseServerStorageUsage(invalid, asOf, 'free'))
      .toThrow('storage.unverified_server_usage')
  })
})

describe('real read-only encrypted queue file list', () => {
  const now = 2_000_000
  const blob = (bytes: number) => ({ blob: new Blob([new Uint8Array(bytes)]) })
  const photo = (suffix: string, state: 'queued' | 'retry' | 'synced' | 'conflict',
    expiresAt = now + 1) => ({
    photoId: '00000000-0000-4000-8000-' + suffix.padStart(12, '0'),
    state, createdAt: now - Number(suffix), expiresAt,
    assets: [blob(20), blob(7)],
  })
  const media = (state: 'queued' | 'retry' | 'synced' | 'conflict',
    expiresAt = now + 1) => ({
    mediaId: '00000000-0000-4000-8000-000000000099',
    mediaType: 'audio' as const, state,
    createdAt: now - 3, expiresAt,
    chunks: [blob(38), blob(2)],
  })

  it('shows only unsynced real Photo/Media opaque records with exact Blob sizes', () => {
    const entries = buildEncryptedQueueEntries([
      photo('1', 'queued'),
      photo('2', 'synced'),
      photo('4', 'retry', now),
      photo('5', 'conflict'),
    ], [media('retry')], now)
    expect(entries.map(e => [e.kind, e.status, e.ciphertextBytes])).toEqual([
      ['photo', 'queued', 27],
      ['audio', 'retry', 40],
      ['photo', 'expired', 27],
      ['photo', 'conflict', 27],
    ])
    expect(entries.every(e => !Object.keys(e).includes('plaintext'))).toBe(true)
    expect(filteredEncryptedQueue(entries, 'all')).toHaveLength(4)
    expect(filteredEncryptedQueue(entries, 'pending').map(e => e.status))
      .toEqual(['queued', 'retry'])
    expect(filteredEncryptedQueue(entries, 'expired')).toHaveLength(1)
    expect(filteredEncryptedQueue(entries, 'conflict')).toHaveLength(1)
    expect(entries.every(e => e.key.startsWith('photo:') || e.key.startsWith('media:'))).toBe(true)
  })

  it('fails closed for corrupt or forged file IDs, creation times and ciphertext', () => {
    const valid = photo('1', 'queued')
    for (const invalid of [
      { ...valid, photoId: 'not-a-uuid' },
      { ...valid, createdAt: NaN },
      { ...valid, expiresAt: -1 },
      { ...valid, state: 'unknown' as 'queued' },
      { ...valid, assets: [] },
      { ...valid, assets: [{ blob: null as unknown as Blob }] },
    ]) expect(() => buildEncryptedQueueEntries([invalid], [], now)).toThrow()
  })

  it('never surfaces locally synced files as outstanding queue rows', () => {
    expect(buildEncryptedQueueEntries([photo('7', 'synced')], [media('synced')], now))
      .toEqual([])
  })
})

describe('manual encrypted queue retry planning (no competing uploader)', () => {
  const base = { kind: 'photo' as const, createdAt: 1000,
    expiresAt: 3000, ciphertextBytes: 64 }
  it('plans only pending Photo/Media, never conflict or expired', () => {
    const entries = [
      { ...base, key: 'photo:00000000-0000-4000-8000-000000000001', status: 'queued' as const },
      { ...base, key: 'media:00000000-0000-4000-8000-000000000002', kind: 'audio' as const, status: 'retry' as const },
      { ...base, key: 'media:00000000-0000-4000-8000-000000000003', status: 'conflict' as const },
    ]
    expect(planManualEncryptedRetry(entries)).toEqual({
      photo: true, media: true, blockedPhoto: false,
    })
    expect(planManualEncryptedRetry([
      { ...base, key: 'photo:00000000-0000-4000-8000-000000000004', status: 'conflict' },
    ])).toEqual({ photo: false, media: false, blockedPhoto: false })
  })

  it('fences global Photo flush when any Photo expiry is past; Media may replay', () => {
    const entries = [
      { ...base, key: 'photo:00000000-0000-4000-8000-000000000001', status: 'retry' as const },
      { ...base, key: 'photo:00000000-0000-4000-8000-000000000002', status: 'expired' as const },
      { ...base, key: 'media:00000000-0000-4000-8000-000000000003', status: 'queued' as const },
    ]
    expect(planManualEncryptedRetry(entries)).toEqual({
      photo: false, media: true, blockedPhoto: true,
    })
  })
})
