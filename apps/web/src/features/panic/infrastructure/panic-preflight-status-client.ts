/**
 * P3 #221: CLIENT READ-ONLY observation of an authenticated HTTP preflight row.
 *
 * This is NOT a server-signed receipt, a destructive instruction, an ACK, an
 * offline post-wipe dispatcher, or a reason to clear the signed local journal.
 * The GET endpoint is NOT mounted in the real app until route-owner review.
 *
 * No URL or account selector is caller-controlled; the *only* identifier in
 * the path comes from the ORIGINAL P-256 device-authenticated signed intent.
 * A successful GET only observes `preflight_only`, NEVER successful Panic.
 */
import {digest, hex} from '../../identity/infrastructure/crypto'
import {verifySignedPanicIntent} from '../domain/panic-intent'
import type {PanicIntentScope, SignedPanicIntent} from '../domain/panic-intent'

type StatusGet = (url: string, init: RequestInit) => Promise<Response>

export type PanicPreflightObservation =
  | Readonly<{
      kind: 'observed_preflight_only_unconfirmed'
      operationId: string
      contractHash: string
      recordedAt: string
    }>
  | Readonly<{
      kind: 'unconfirmed'
      reason: 'invalid_local_intent' | 'session_unavailable'
        | 'not_observable' | 'network_unavailable' | 'invalid_response'
    }>

const FIELDS = ['phase', 'operationId', 'contractHash', 'recordedAt']
const SHA256 = /^[a-f0-9]{64}$/
const MAX_BODY_BYTES = 512
const MAX_STREAM_CHUNKS = 64
const FUTURE_SKEW_MS = 120_000

function unconfirmed(reason: Extract<PanicPreflightObservation,
  {kind: 'unconfirmed'}>['reason']): PanicPreflightObservation {
  return Object.freeze({kind: 'unconfirmed', reason})
}

function validDate(raw: unknown, nowMs: number): raw is string {
  if (typeof raw !== 'string') return false
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString() === raw
    && timestamp <= nowMs + FUTURE_SKEW_MS
}

function equalKeys(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === FIELDS.slice().sort().join('|')
}

/**
 * Bound bytes BEFORE buffering, even when Content-Length is absent or forged.
 * Only real response streams are accepted: a missing/locked body fails closed.
 * Fatal UTF-8 + raw JSON round-trip rejects duplicate keys, reordered aliases,
 * whitespace/malleable serialization and ambiguous parser interpretations.
 */
async function readBoundedStatusJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('panic.invalid_response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', {fatal: true})
  let bytes = 0
  let chunks = 0
  let raw = ''
  try {
    while (true) {
      const piece = await reader.read()
      if (piece.done) break
      bytes += piece.value.byteLength
      chunks += 1
      if (bytes > MAX_BODY_BYTES || chunks > MAX_STREAM_CHUNKS) {
        throw new Error('panic.invalid_response')
      }
      raw += decoder.decode(piece.value, {stream: true})
    }
    raw += decoder.decode()
  } catch {
    // Best-effort stream cancellation; never await an untrusted stream's
    // cancellation promise and never turn the failure into an ACK.
    void reader.cancel().catch(() => {})
    throw new Error('panic.invalid_response')
  } finally {
    reader.releaseLock()
  }
  if (bytes < 100 || bytes > MAX_BODY_BYTES) {
    throw new Error('panic.invalid_response')
  }
  const parsed: unknown = JSON.parse(raw)
  if (JSON.stringify(parsed) !== raw) {
    throw new Error('panic.invalid_response')
  }
  return parsed
}

/**
 * Single, bounded, SAME-ORIGIN, read-only observation. There are no retries:
 * the signed original must remain durable; uncertain/offline HTTP does not
 * prove rejection or acceptance and does not clear anything.
 *
 * A 200 response has the confidence of a same-origin authenticated DB read
 * ONLY, not the independent `verifyPanicPreflightEvidence` server signature.
 * Treat BOTH branches as `not deleted` for any product/UI security decision.
 *
 * Request injection is test-only; production callers must not use a
 * caller-controlled endpoint. The original URL is never supplied by callers.
 */
export async function observePreparedPanicStatus(
  original: SignedPanicIntent,
  trustedScope: PanicIntentScope,
  trustedDeviceSpki: string,
  options: {request?: StatusGet, nowMs?: number} = {},
): Promise<PanicPreflightObservation> {
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return unconfirmed('invalid_local_intent')
  }
  let operationId: string
  let originalHash: string
  try {
    const intent = await verifySignedPanicIntent(
      original, trustedScope, trustedDeviceSpki, nowMs)
    operationId = intent.operationId
    // Bind even a legitimate HTTP 200 to the EXACT signed original bytes.
    originalHash = hex(await digest(new TextEncoder().encode(original.contract)))
  } catch {
    return unconfirmed('invalid_local_intent')
  }

  let response: Response
  try {
    const request = options.request ?? fetch
    response = await request('/panic/v1/preflight/' + operationId, {
      method: 'GET',
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return unconfirmed('network_unavailable')
  }

  // 404 is deliberately ambiguous: route may be unmounted, row absent,
  // revoked, or masked by owner-only routing. Never say "deleted/rejected".
  if (response.status === 401 || response.status === 403) {
    return unconfirmed('session_unavailable')
  }
  if (response.status === 404) return unconfirmed('not_observable')
  if (response.status !== 200 || !response.ok) {
    return unconfirmed('network_unavailable')
  }
  if (response.redirected || response.type === 'opaque'
    || response.type === 'opaqueredirect') {
    return unconfirmed('invalid_response')
  }

  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mime !== 'application/json') return unconfirmed('invalid_response')
  const size = response.headers.get('content-length')
  if (size !== null && (/[^0-9]/.test(size) || Number(size) > MAX_BODY_BYTES)) {
    return unconfirmed('invalid_response')
  }

  let value: unknown
  try {
    value = await readBoundedStatusJson(response)
  } catch {
    return unconfirmed('invalid_response')
  }

  if (!equalKeys(value)
    || value.phase !== 'preflight_only'
    || value.operationId !== operationId
    || value.contractHash !== originalHash
    || typeof value.contractHash !== 'string'
    || !SHA256.test(value.contractHash)
    || !validDate(value.recordedAt, nowMs)) {
    return unconfirmed('invalid_response')
  }

  return Object.freeze({
    kind: 'observed_preflight_only_unconfirmed',
    operationId,
    contractHash: originalHash,
    recordedAt: value.recordedAt,
  })
}
