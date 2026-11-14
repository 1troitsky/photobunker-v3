/**
 * P3 #221: VERIFY-ONLY, signed server-preflight evidence.
 *
 * This contract is intentionally NOT a server ACK, revoke, cloud GC receipt,
 * or completion.  Its ONLY legal phase is 'preflight_only'.  The production
 * trust anchor and signing service DO NOT EXIST in this PR: callers must use
 * an independently authenticated server SPKI, never an SPKI from the wire.
 *
 * No I/O, no network requests, no key provisioning and no destructive effects.
 */
import {
  canonical, digest, hex, importSpki, unb64, verify,
} from '../../identity/infrastructure/crypto'
import {
  parsePanicIntent, verifySignedPanicIntent,
} from './panic-intent'
import type {
  PanicIntentScope, SignedPanicIntent,
} from './panic-intent'

const DOMAIN = 'photobunker.panic.preflight-evidence.v1\n'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[a-f0-9]{64}$/
const FIELDS = [
  'accountId', 'contractHash', 'deviceId', 'keyRevision', 'operationId',
  'phase', 'purpose', 'recordedAt', 'vault', 'version',
]
const FUTURE_CLOCK_SKEW_MS = 120_000

export type PanicPreflightEvidenceStatement = Readonly<{
  version: 1
  purpose: 'panic.preflight-recorded'
  phase: 'preflight_only'
  accountId: string
  deviceId: string
  keyRevision: number
  operationId: string
  contractHash: string
  recordedAt: string
  vault: 'preserve-existing-verified'
}>

export type SignedPanicPreflightEvidence = Readonly<{
  statement: string
  signature: string
}>

/**
 * A checked PRE-FLIGHT record is NOT a backend-accepted destructive intent,
 * server revoke, cloud-delete ACK or physical storage evidence.
 */
export type VerifiedPanicPreflightEvidence = Readonly<{
  phase: 'preflight_only'
  accountId: string
  deviceId: string
  operationId: string
  contractHash: string
  recordedAt: string
}>

function invalid(): never { throw new Error('panic.invalid_preflight_evidence') }

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

function parseDate(raw: unknown): number {
  if (typeof raw !== 'string') invalid()
  const when = Date.parse(raw)
  if (!Number.isFinite(when) || new Date(when).toISOString() !== raw) invalid()
  return when
}

/** Shape validation ONLY; never use this as signature evidence. */
export function parsePanicPreflightEvidence(value: unknown): PanicPreflightEvidenceStatement {
  if (typeof value !== 'string' || value.length < 180 || value.length > 1024) invalid()
  let json: unknown
  try { json = JSON.parse(value) } catch { invalid() }
  if (!exact(json, FIELDS)) invalid()
  const obj = json as Record<string, unknown>
  if (canonical(obj) !== value
    || obj.version !== 1
    || obj.purpose !== 'panic.preflight-recorded'
    || obj.phase !== 'preflight_only'
    || obj.vault !== 'preserve-existing-verified'
    || typeof obj.accountId !== 'string' || !UUID.test(obj.accountId)
    || typeof obj.deviceId !== 'string' || !UUID.test(obj.deviceId)
    || typeof obj.operationId !== 'string' || !UUID.test(obj.operationId)
    || !Number.isSafeInteger(obj.keyRevision) || (obj.keyRevision as number) < 1
    || typeof obj.contractHash !== 'string' || !HASH.test(obj.contractHash)) invalid()
  parseDate(obj.recordedAt)
  return obj as PanicPreflightEvidenceStatement
}

/**
 * This proves ONLY that an independently trusted server key signed a statement
 * about one particular original, device-authenticated PRE-FLIGHT operation.
 * It CANNOT prove database storage, current device authorization, delete,
 * cloud GC, Matrix revocation or any server-side state transition.
 *
 * IMPORTANT: server signing key provisioning, trust-anchor distribution,
 * and a real server-signed statement endpoint remain unimplemented.
 */
export async function verifyPanicPreflightEvidence(
  evidence: unknown,
  originalSignedIntent: SignedPanicIntent,
  expected: PanicIntentScope,
  trustedDeviceSpki: string,
  trustedServerSpki: string,
  nowMs = Date.now(),
): Promise<VerifiedPanicPreflightEvidence> {
  try {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0
      || typeof trustedDeviceSpki !== 'string'
      || typeof trustedServerSpki !== 'string'
      || !trustedServerSpki || trustedServerSpki === trustedDeviceSpki) invalid()
    if (!exact(evidence, ['statement', 'signature'])) invalid()
    const signed = evidence as Record<string, unknown>
    if (typeof signed.statement !== 'string' || typeof signed.signature !== 'string') invalid()
    unb64(signed.signature, 64)
    const statement = parsePanicPreflightEvidence(signed.statement)
    const original = await verifySignedPanicIntent(
      originalSignedIntent, expected, trustedDeviceSpki, nowMs)
    if (statement.accountId !== original.accountId
      || statement.deviceId !== original.deviceId
      || statement.keyRevision !== original.keyRevision
      || statement.operationId !== original.operationId
      || statement.vault !== original.vault
      || parseDate(statement.recordedAt) > nowMs + FUTURE_CLOCK_SKEW_MS) invalid()

    // The exact ORIGINAL signed contract bytes are bound by SHA256, NOT a
    // reserialized view.  This prevents a different command or stale replay
    // being laundered into the same external server evidence.
    const body = parsePanicIntent(originalSignedIntent.contract)
    if (body.operationId !== original.operationId) invalid()
    const originalHash = hex(await digest(new TextEncoder().encode(originalSignedIntent.contract)))
    if (statement.contractHash !== originalHash) invalid()
    const serverKey = await importSpki(trustedServerSpki)
    if (!await verify(serverKey, DOMAIN + signed.statement, signed.signature)) invalid()

    return Object.freeze({
      phase: 'preflight_only',
      accountId: statement.accountId,
      deviceId: statement.deviceId,
      operationId: statement.operationId,
      contractHash: statement.contractHash,
      recordedAt: statement.recordedAt,
    })
  } catch { invalid() }
}
