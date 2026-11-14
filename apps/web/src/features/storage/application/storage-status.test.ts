import { describe, expect, it } from 'vitest'
import {
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
