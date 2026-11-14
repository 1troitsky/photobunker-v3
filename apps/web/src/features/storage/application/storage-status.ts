import { activeSession, requireSession, type Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { parseGraceStatus } from '../../billing/application/grace-client'
import { listLocalPhotos, type StoredPhoto } from '../../photo-sync/application/p1-photo'
import { listLocalMedia, type StoredMedia } from '../../media/application/media-outbox'

type State = 'queued' | 'retry' | 'synced' | 'conflict'
type BlobPart = { blob: Blob }
type PhotoRow = { state: State; expiresAt: number; assets: readonly BlobPart[] }
type MediaRow = { state: State; expiresAt: number; chunks: readonly BlobPart[] }

export interface LocalStorageSummary {
  readonly pendingCount: number
  readonly pendingCipherBytes: number
  readonly conflictedCount: number
  readonly expiredPendingCount: number
  readonly syncedLocalCount: number
}

/**
 * Counts *actual local encrypted Blobs*, not original plaintext lengths,
 * estimated cloud usage, or objects that may already have been garbage collected.
 * Unsynced expired objects are reported separately, never advertised as uploadable.
 */
export function summarizeEncryptedQueue(
  photos: readonly PhotoRow[],
  media: readonly MediaRow[],
  now = Date.now(),
): LocalStorageSummary {
  let pendingCount = 0
  let pendingCipherBytes = 0
  let conflictedCount = 0
  let expiredPendingCount = 0
  let syncedLocalCount = 0
  const rows: ReadonlyArray<{ state: State; expiresAt: number; blobs: readonly BlobPart[] }> = [
    ...photos.map(p => ({ state: p.state, expiresAt: p.expiresAt, blobs: p.assets })),
    ...media.map(m => ({ state: m.state, expiresAt: m.expiresAt, blobs: m.chunks })),
  ]
  for (const row of rows) {
    if (row.state === 'synced') { syncedLocalCount++; continue }
    if (row.state === 'conflict') { conflictedCount++; continue }
    if (row.state !== 'queued' && row.state !== 'retry')
      throw Error('storage.invalid_queue_state')
    if (!Number.isSafeInteger(row.expiresAt) || row.expiresAt <= now) {
      expiredPendingCount++
      continue
    }
    let bytes = 0
    if (!row.blobs.length) throw Error('storage.invalid_ciphertext_record')
    for (const item of row.blobs) {
      if (!(item.blob instanceof Blob) || !Number.isSafeInteger(item.blob.size))
        throw Error('storage.invalid_ciphertext_record')
      bytes += item.blob.size
      if (!Number.isSafeInteger(bytes)) throw Error('storage.queue_overflow')
    }
    pendingCount++
    pendingCipherBytes += bytes
    if (!Number.isSafeInteger(pendingCipherBytes)) throw Error('storage.queue_overflow')
  }
  return { pendingCount, pendingCipherBytes, conflictedCount, expiredPendingCount, syncedLocalCount }
}

function sameSession(session: Session): void {
  if (activeSession.value !== session) throw Error('storage.session_changed')
}

export async function readEncryptedLocalQueue(): Promise<LocalStorageSummary> {
  const session = requireSession()
  // Both repositories already enforce account-scoped IndexedDB queries.
  const [photos, media]: [StoredPhoto[], StoredMedia[]] = await Promise.all([
    listLocalPhotos(), listLocalMedia(),
  ])
  sameSession(session) // No stale rows may render after sign-out/account switch.
  return summarizeEncryptedQueue(photos, media)
}

export interface ServerStorageUsage {
  readonly planId: string
  readonly recordedCipherBytes: number
  readonly activeLogicalMediaFiles: number
  readonly assignmentsCreatedThisUtcMonth: number
  readonly enforcedByteCeiling: number
  readonly asOfUtc: string
  readonly byteUnitPolicy: string
}
type RecordValue = Record<string, unknown>
function isRecord(v: unknown): v is RecordValue {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function safeNonnegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

/** Read-only SERVER measurement; never use this value for quota admission. */
export function parseServerStorageUsage(
  raw: unknown, trustedAsOf: string, effectivePlanId: string,
): ServerStorageUsage {
  if (!isRecord(raw)
    || raw.measurement !== 'read_only_non_atomic'
    || raw.asOfUtc !== trustedAsOf
    || !safeNonnegative(raw.recordedCipherBytes)
    || !safeNonnegative(raw.activeLogicalMediaFiles)
    || !safeNonnegative(raw.assignmentsCreatedThisUtcMonth)
    || !safeNonnegative(raw.enforcedByteCeiling)
    || raw.enforcedByteCeiling === 0
    || !['OPEN_GB_VS_GIB', 'DECIMAL_GB_TB_V1'].includes(String(raw.byteUnitPolicy))
    || !['legacy_technical_guard', 'plan_plus_free_technical_guard', 'plan_entitlement']
      .includes(String(raw.quotaSource)))
    throw Error('storage.unverified_server_usage')
  return {
    planId: effectivePlanId,
    recordedCipherBytes: raw.recordedCipherBytes as number,
    activeLogicalMediaFiles: raw.activeLogicalMediaFiles as number,
    assignmentsCreatedThisUtcMonth: raw.assignmentsCreatedThisUtcMonth as number,
    enforcedByteCeiling: raw.enforcedByteCeiling as number,
    asOfUtc: trustedAsOf,
    byteUnitPolicy: raw.byteUnitPolicy as string,
  }
}

export async function readServerStorageUsage(session: Session): Promise<ServerStorageUsage> {
  if (!session.online || activeSession.value !== session)
    throw Error('storage.session_unverified')
  // The authenticated endpoint scopes usage to the actual server session;
  // no caller-supplied accountId, planId, revision or private metadata.
  const response: unknown = await jsonApi<unknown>('/billing/v1/me')
  sameSession(session)
  const grace = parseGraceStatus(response)
  if (!isRecord(response)) throw Error('storage.unverified_server_usage')
  const measured = parseServerStorageUsage(response.usage, grace.asOfAt, grace.effectivePlanId)
  sameSession(session)
  return measured
}
