/**
 * P3 #221: strictly scoped, signed Emergency PIN destructive-intent WIRE format.
 *
 * This module has NO I/O, cannot unlock PINs, wipe local data, send HTTP requests,
 * change a server ACL, delete cloud objects or certify a server acknowledgement.
 * A future fail-closed Panic controller must atomically durably queue the signed
 * envelope BEFORE dropping signing keys, and a separately authenticated server
 * must verify this exact contract against CURRENT revocation/authorization state.
 */
import {
  b64, canonical, importSpki, random, sign, unb64, verify,
} from '../../identity/infrastructure/crypto'

const DOMAIN = 'photobunker.panic.intent.v1\n'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTRACT_FIELDS = [
  'accountId', 'deviceId', 'issuedAt', 'keyRevision', 'liveScope',
  'nonce', 'operationId', 'purpose', 'vault', 'version',
].join('|')
/** Intent clock only prohibits fabricated future timestamps; never age out an
 * offline emergency request on the client. Server policy is authoritative. */
const MAX_FUTURE_SKEW_MS = 120_000

export type PanicIntentContract = Readonly<{
  version: 1
  purpose: 'panic.live-delete'
  operationId: string
  accountId: string
  deviceId: string
  keyRevision: number
  nonce: string
  issuedAt: string
  liveScope: 'all-live-locations'
  vault: 'preserve-existing-verified'
}>

export type SignedPanicIntent = Readonly<{
  contract: string
  signature: string
}>

export type PanicIntentScope = Readonly<{
  accountId: string
  deviceId: string
  keyRevision: number
}>

function invalid(): never { throw new Error('panic.invalid_intent') }

function validScope(scope: PanicIntentScope): void {
  if (!scope || !UUID.test(scope.accountId) || !UUID.test(scope.deviceId)
    || !Number.isSafeInteger(scope.keyRevision) || scope.keyRevision < 1) invalid()
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
}

/**
 * Rejects unknown fields, duplicate keys, noncanonical serialization,
 * cross-purpose envelopes and anything that would include Recovery Vault.
 * Parsing alone NEVER authenticates an intent.
 */
export function parsePanicIntent(value: unknown): PanicIntentContract {
  if (typeof value !== 'string' || value.length < 120 || value.length > 1024) invalid()
  let raw: unknown
  try { raw = JSON.parse(value) } catch { invalid() }
  if (!exactObject(raw, CONTRACT_FIELDS.split('|'))) invalid()
  const obj = raw as Record<string, unknown>
  if (canonical(obj) !== value || obj.version !== 1
    || obj.purpose !== 'panic.live-delete'
    || obj.liveScope !== 'all-live-locations'
    || obj.vault !== 'preserve-existing-verified'
    || !UUID.test(String(obj.operationId))
    || !UUID.test(String(obj.accountId))
    || !UUID.test(String(obj.deviceId))
    || !Number.isSafeInteger(obj.keyRevision)
    || (obj.keyRevision as number) < 1
    || typeof obj.nonce !== 'string'
    || typeof obj.issuedAt !== 'string') invalid()
  try { unb64(obj.nonce as string, 32) } catch { invalid() }
  const when = Date.parse(obj.issuedAt as string)
  if (!Number.isFinite(when) || new Date(when).toISOString() !== obj.issuedAt) invalid()
  return obj as unknown as PanicIntentContract
}

function envelope(value: unknown): SignedPanicIntent {
  if (!exactObject(value, ['contract', 'signature'])) invalid()
  const obj = value as Record<string, unknown>
  if (typeof obj.contract !== 'string' || typeof obj.signature !== 'string') invalid()
  try { unb64(obj.signature as string, 64) } catch { invalid() }
  parsePanicIntent(obj.contract)
  return obj as SignedPanicIntent
}

/**
 * Sign with the CURRENT, already-unlocked trusted device signer only, not a
 * user-supplied key. Do not run until the caller has latched a local lock.
 * The output has no plaintext PIN, Recovery Key, Vault locator or media data.
 */
export async function createSignedPanicIntent(
  scope: PanicIntentScope, deviceSigner: CryptoKey, nowMs = Date.now(),
): Promise<SignedPanicIntent> {
  validScope(scope)
  if (!Number.isSafeInteger(nowMs) || nowMs < 0
    || nowMs > 8_640_000_000_000_000) invalid()
  const contract: PanicIntentContract = {
    version: 1, purpose: 'panic.live-delete',
    operationId: crypto.randomUUID(),
    accountId: scope.accountId, deviceId: scope.deviceId,
    keyRevision: scope.keyRevision,
    nonce: b64(random(32)), issuedAt: new Date(nowMs).toISOString(),
    liveScope: 'all-live-locations', vault: 'preserve-existing-verified',
  }
  const json = canonical(contract as unknown as Record<string, unknown>)
  const signature = await sign(deviceSigner, DOMAIN + json)
  // Prevent a caller from receiving a corrupt local envelope and treating
  // that failed signature operation as an acknowledged destructive action.
  envelope({contract: json, signature})
  return {contract: json, signature}
}

/**
 * Authenticate against a TRUSTED device SPKI (e.g. previously verified
 * device registration), never a SPKI carried by the intent itself.
 * Does NOT confer server authorization, establish freshness against replay,
 * or confirm an actual deletion; backend must persist operationId atomically.
 */
export async function verifySignedPanicIntent(
  value: unknown, expected: PanicIntentScope, trustedDeviceSpki: string,
  nowMs = Date.now(),
): Promise<PanicIntentContract> {
  validScope(expected)
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) invalid()
  const signed = envelope(value)
  const contract = parsePanicIntent(signed.contract)
  if (contract.accountId !== expected.accountId
    || contract.deviceId !== expected.deviceId
    || contract.keyRevision !== expected.keyRevision
    || Date.parse(contract.issuedAt) > nowMs + MAX_FUTURE_SKEW_MS) invalid()
  try {
    const key = await importSpki(trustedDeviceSpki)
    if (!await verify(key, DOMAIN + signed.contract, signed.signature)) invalid()
  } catch { invalid() }
  return contract
}

/**
 * Local replay/collision classifier for ONE durably stored operation. A retry
 * must replay its original bytes, never mint a new envelope for that ID.
 * This is NOT a persistent anti-replay ledger or server authorization gate.
 */
export function isIdenticalPanicRetry(
  stored: SignedPanicIntent, candidate: SignedPanicIntent,
): boolean {
  const first = envelope(stored), next = envelope(candidate)
  const a = parsePanicIntent(first.contract), b = parsePanicIntent(next.contract)
  if (a.operationId !== b.operationId) return false
  if (first.contract !== next.contract || first.signature !== next.signature)
    throw new Error('panic.operation_collision')
  return true
}
