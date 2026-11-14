import { activeSession, requireSession, type Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import { parseGraceStatus } from '../../billing/application/grace-client'
import { flushOutbox, listLocalPhotos, type StoredPhoto } from '../../photo-sync/application/p1-photo'
import { flushMediaOutbox, listLocalMedia, type StoredMedia } from '../../media/application/media-outbox'

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


export type QueueDisplayFilter = 'all' | 'pending' | 'conflict' | 'expired'
export interface EncryptedQueueEntry {
  readonly key: string
  readonly kind: 'photo' | 'video' | 'audio'
  readonly status: State | 'expired'
  readonly createdAt: number
  readonly expiresAt: number
  readonly ciphertextBytes: number
}
type QueuePhotoRow = {
  photoId: string; state: State; createdAt: number; expiresAt: number
  assets: readonly BlobPart[]
}
type QueueMediaRow = {
  mediaId: string; mediaType: 'photo' | 'video' | 'audio'
  state: State; createdAt: number; expiresAt: number
  chunks: readonly BlobPart[]
}

function ciphertextByteCount(blobs: readonly BlobPart[]): number {
  if (!blobs.length) throw Error('storage.invalid_ciphertext_record')
  let bytes = 0
  for (const item of blobs) {
    if (!(item.blob instanceof Blob) || !Number.isSafeInteger(item.blob.size))
      throw Error('storage.invalid_ciphertext_record')
    bytes += item.blob.size
    if (!Number.isSafeInteger(bytes)) throw Error('storage.queue_overflow')
  }
  return bytes
}

/**
 * Read-only, account-scoped detail derived from the same encrypted IndexedDB
 * rows as the summary. No plaintext filename/description/GPS is decrypted.
 * The ID is an opaque file reference displayed only inside an authenticated UI.
 */
export function buildEncryptedQueueEntries(
  photos: readonly QueuePhotoRow[],
  media: readonly QueueMediaRow[],
  now = Date.now(),
): EncryptedQueueEntry[] {
  const rows = [
    ...photos.map(p => ({
      key: 'photo:' + p.photoId, kind: 'photo' as const,
      state: p.state, createdAt: p.createdAt, expiresAt: p.expiresAt,
      blobs: p.assets,
    })),
    ...media.map(m => ({
      key: 'media:' + m.mediaId, kind: m.mediaType,
      state: m.state, createdAt: m.createdAt, expiresAt: m.expiresAt,
      blobs: m.chunks,
    })),
  ]
  const result: EncryptedQueueEntry[] = []
  for (const row of rows) {
    if (row.state === 'synced') continue
    if (typeof row.key !== 'string' || !/^(photo|media):[a-f0-9-]{20,}$/i.test(row.key)
      || !['photo', 'video', 'audio'].includes(row.kind)
      || !['queued', 'retry', 'conflict'].includes(row.state)
      || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0
      || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= 0)
      throw Error('storage.invalid_queue_record')
    const status = row.state === 'conflict' ? 'conflict'
      : row.expiresAt <= now ? 'expired' : row.state
    result.push({
      key: row.key, kind: row.kind, status,
      createdAt: row.createdAt, expiresAt: row.expiresAt,
      ciphertextBytes: ciphertextByteCount(row.blobs),
    })
  }
  return result.sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}

export function filteredEncryptedQueue(
  entries: readonly EncryptedQueueEntry[], filter: QueueDisplayFilter,
): EncryptedQueueEntry[] {
  switch (filter) {
    case 'all': return [...entries]
    case 'pending': return entries.filter(e => e.status === 'queued' || e.status === 'retry')
    case 'conflict': return entries.filter(e => e.status === 'conflict')
    case 'expired': return entries.filter(e => e.status === 'expired')
  }
}

function sameSession(session: Session): void {
  if (activeSession.value !== session) throw Error('storage.session_changed')
}

export interface EncryptedQueueDetails {
  readonly summary: LocalStorageSummary
  readonly entries: readonly EncryptedQueueEntry[]
}

export async function readEncryptedLocalQueueDetails(): Promise<EncryptedQueueDetails> {
  const session = requireSession()
  // Both original repositories query only the current authenticated account.
  const [photos, media]: [StoredPhoto[], StoredMedia[]] = await Promise.all([
    listLocalPhotos(), listLocalMedia(),
  ])
  sameSession(session)
  const now = Date.now()
  const summary = summarizeEncryptedQueue(photos, media, now)
  const entries = buildEncryptedQueueEntries(photos, media, now)
  sameSession(session) // No stale rows may render after logout/account change.
  return { summary, entries }
}

export async function readEncryptedLocalQueue(): Promise<LocalStorageSummary> {
  return (await readEncryptedLocalQueueDetails()).summary
}

/**
 * Only invokes the EXISTING idempotent outboxes. The legacy Photo flush
 * scans every non-conflict row; while any Photo is expired, do not invoke
 * that global flush (it cannot target just live Photo rows). MediaFile's
 * own core already fences expiry before issuing network requests.
 */
export interface ManualEncryptedRetryPlan {
  readonly photo: boolean
  readonly media: boolean
  readonly blockedPhoto: boolean
}
export function planManualEncryptedRetry(
  entries: readonly EncryptedQueueEntry[],
): ManualEncryptedRetryPlan {
  const pending = entries.filter(e => e.status === 'queued' || e.status === 'retry')
  const hasLivePhoto = pending.some(e => e.key.startsWith('photo:'))
  const hasExpiredPhoto = entries.some(e =>
    e.key.startsWith('photo:') && e.status === 'expired')
  return {
    photo: hasLivePhoto && !hasExpiredPhoto,
    media: pending.some(e => e.key.startsWith('media:')),
    blockedPhoto: hasLivePhoto && hasExpiredPhoto,
  }
}

export interface ManualEncryptedRetryResult {
  readonly attempted: boolean
  readonly failed: boolean
  readonly blockedPhoto: boolean
  readonly details: EncryptedQueueDetails
}

/**
 * User-triggered replay, never a second uploader/worker or a status
 * fabrication. Underlying outboxes own idempotence, encrypted transport,
 * server ACK, expiry and conflict handling. No blob is deleted.
 */
export async function retryPendingEncryptedQueue(
  session: Session,
): Promise<ManualEncryptedRetryResult> {
  if (activeSession.value !== session || !session.online
    || (typeof navigator !== 'undefined' && !navigator.onLine))
    throw Error('storage.retry_requires_online_session')

  const before = await readEncryptedLocalQueueDetails()
  sameSession(session)
  const plan = planManualEncryptedRetry(before.entries)
  const attempts: Promise<void>[] = []
  if (plan.photo) attempts.push(flushOutbox())
  if (plan.media) attempts.push(flushMediaOutbox())
  const outcomes = await Promise.allSettled(attempts)
  sameSession(session)
  // Re-read the durable IndexedDB states; never infer cloud success merely
  // from completion of a function (the original outboxes may have caught 503).
  const details = await readEncryptedLocalQueueDetails()
  sameSession(session)
  return {
    attempted: attempts.length > 0,
    failed: outcomes.some(result => result.status === 'rejected'),
    blockedPhoto: plan.blockedPhoto,
    details,
  }
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
