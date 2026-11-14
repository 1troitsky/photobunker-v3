import Dexie from 'dexie'
import {validPinRelockDelayMs} from './pin-relock-policy'

/**
 * Offline PIN check only. This is NOT session authorization and must never directly
 * unlock account keys or execute the emergency/Panic workflow.
 *
 * Standalone Dexie callers must supply a separate non-extractable high-entropy
 * HMAC key; do not persist it in that standalone verifier database.
 * The separate, UNWIRED Identity-v2 co-located migration deliberately persists
 * a non-extractable HMAC CryptoKey in the same device row as the verifier for
 * atomicity. It DOES NOT prevent offline guessing by same-origin code that can
 * invoke WebCrypto operations on that key; never present it as a trusted gate.
 */
const PBKDF2_ITERATIONS = 600_000
const MAX_FAILURES = 5
const LOCKOUT_MS = 30 * 60 * 1000
const SALT_BYTES = 32
const TAG_BYTES = 32

type PinRole = 'app' | 'emergency'

type StoredVerifier = {
  salt: number[]
  tag: number[]
}

export type StoredPinState = {
  id: string
  version: 1
  accountId: string
  deviceId: string
  revision: string
  app: StoredVerifier
  emergency: StoredVerifier | null
  failures: number
  lockedUntilMs: number
  lastObservedMs: number
  /** Present only in HMAC-v2 policy records. Missing older v1 = Immediate. */
  relockDelayMs?: number
  integrityTag: number[]
}

export type PinScope = {
  accountId: string
  deviceId: string
}

export type PinAttempt =
  | {status: 'app-unlocked'}
  | {status: 'emergency-intent'}
  | {status: 'invalid'; attemptsRemaining: number}
  | {status: 'locked'; retryAfterMs: number}
  | {status: 'clock-rollback'}

const db = new Dexie('pb3_pin_verifier_v1')
db.version(1).stores({records: 'id'})
const records = db.table<StoredPinState, string>('records')
const encoder = new TextEncoder()

function scopeId(scope: PinScope): string {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(scope.accountId) ||
      !/^[a-zA-Z0-9-]{8,64}$/.test(scope.deviceId)) {
    throw new Error('pin.invalid_scope')
  }
  return scope.accountId + ':' + scope.deviceId
}

function validatePin(pin: string): void {
  if (!/^[0-9]{4,8}$/.test(pin)) {
    throw new Error('pin.invalid_format')
  }
}

function requireDeviceSecret(secret: CryptoKey): void {
  const algorithm = secret.algorithm as HmacKeyAlgorithm
  if (secret.extractable || algorithm.name !== 'HMAC' ||
      algorithm.hash?.name !== 'SHA-256' || algorithm.length < 256 ||
      !secret.usages.includes('sign')) {
    throw new Error('pin.invalid_device_secret')
  }
}

function validateVerifier(
  verifier: StoredVerifier | null | undefined, optional = false,
): void {
  if (verifier === null && optional) return
  if (!verifier || typeof verifier !== 'object') {
    throw new Error('pin.corrupt_record')
  }
  if (!Array.isArray(verifier.salt) || verifier.salt.length !== SALT_BYTES ||
      !Array.isArray(verifier.tag) || verifier.tag.length !== TAG_BYTES ||
      ![...verifier.salt, ...verifier.tag].every(
        n => Number.isInteger(n) && n >= 0 && n <= 255,
      )) {
    throw new Error('pin.corrupt_record')
  }
}

function validateState(row: StoredPinState, scope: PinScope): void {
  const keys = [
    'accountId', 'app', 'deviceId', 'emergency', 'failures', 'id',
    'integrityTag', 'lastObservedMs', 'lockedUntilMs', 'revision', 'version',
  ]
  const hasRelock = row !== null && typeof row === 'object' &&
    Object.prototype.hasOwnProperty.call(row, 'relockDelayMs')
  if (hasRelock) keys.push('relockDelayMs')
  if (!row || typeof row !== 'object' ||
      Object.keys(row).sort().join('|') !== keys.sort().join('|')) {
    throw new Error('pin.corrupt_record')
  }
  if (hasRelock) {
    try { validPinRelockDelayMs(row.relockDelayMs) }
    catch { throw new Error('pin.corrupt_record') }
  }
  if (!Array.isArray(row.integrityTag) || row.integrityTag.length !== TAG_BYTES ||
      !row.integrityTag.every(n =>
        Number.isInteger(n) && n >= 0 && n <= 255,
      )) throw new Error('pin.corrupt_record')
  if (row.version !== 1 || row.id !== scopeId(scope) ||
      row.accountId !== scope.accountId || row.deviceId !== scope.deviceId ||
      typeof row.revision !== 'string' || row.revision.length < 16 ||
      !Number.isSafeInteger(row.failures) || row.failures < 0 ||
      row.failures > MAX_FAILURES ||
      !Number.isSafeInteger(row.lockedUntilMs) || row.lockedUntilMs < 0 ||
      !Number.isSafeInteger(row.lastObservedMs) || row.lastObservedMs < 0) {
    throw new Error('pin.corrupt_record')
  }
  validateVerifier(row.app)
  validateVerifier(row.emergency, true)
}

/**
 * A device-bound MAC authenticates *both* verifier material and the mutable
 * lockout ledger. An attacker rewriting IDB timestamps/counters cannot
 * silently clear the lock without the non-extractable key.
 *
 * A replay of an OLD valid MACed snapshot is not detectable offline without
 * an independent monotonic counter; do not advertise rollback resistance.
 */
function stateFrame(row: StoredPinState): Uint8Array<ArrayBuffer> {
  const hasRelock=Object.prototype.hasOwnProperty.call(row,'relockDelayMs')
  // Legacy verifier rows retain their ORIGINAL v1 HMAC frame. A real 0–5min
  // setting uses a different domain and includes the exact delay in the MAC.
  // Removing relockDelayMs from a v2 row changes the domain -> HMAC mismatch.
  return encoder.encode(JSON.stringify([
    hasRelock?'PB3/PIN/ledger/v2':'PB3/PIN/ledger/v1',
    row.id, row.version, row.accountId, row.deviceId, row.revision,
    row.app.salt, row.app.tag,
    row.emergency?.salt ?? null, row.emergency?.tag ?? null,
    row.failures, row.lockedUntilMs, row.lastObservedMs,
    ...(hasRelock?[row.relockDelayMs]:[]),
  ]))
}

async function calculateStateTag(
  row: StoredPinState, secret: CryptoKey,
): Promise<number[]> {
  return Array.from(new Uint8Array(
    await crypto.subtle.sign('HMAC', secret, stateFrame(row)),
  ))
}

async function verifyStoredState(
  row: StoredPinState, scope: PinScope, secret: CryptoKey,
): Promise<void> {
  validateState(row, scope)
  const actual = new Uint8Array(await calculateStateTag(row, secret))
  if (!sameTag(actual, row.integrityTag)) {
    throw new Error('pin.integrity_failed')
  }
}

async function calculateTag(
  pin: string,
  role: PinRole,
  salt: Uint8Array<ArrayBuffer>,
  secret: CryptoKey,
  scope: PinScope,
): Promise<Uint8Array<ArrayBuffer>> {
  // PBKDF2 is intentionally not persisted; the device/session secret also
  // prevents an offline attacker from testing short-PIN guesses using only IDB.
  const pinKey = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'],
  )
  const derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt,
    iterations: PBKDF2_ITERATIONS,
  }, pinKey, 256))
  const domain = encoder.encode(
    'PB3/PIN/v1/' + role + '/' + scope.accountId + '/' + scope.deviceId + '/',
  )
  const input = new Uint8Array(domain.byteLength + salt.byteLength + derived.byteLength)
  input.set(domain)
  input.set(salt, domain.byteLength)
  input.set(derived, domain.byteLength + salt.byteLength)
  try {
    return new Uint8Array(await crypto.subtle.sign('HMAC', secret, input))
  } finally {
    derived.fill(0)
    input.fill(0)
  }
}

async function buildVerifier(
  pin: string, role: PinRole, secret: CryptoKey, scope: PinScope,
): Promise<StoredVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const tag = await calculateTag(pin, role, salt, secret, scope)
  return {salt: Array.from(salt), tag: Array.from(tag)}
}

function sameTag(left: Uint8Array, right: number[]): boolean {
  if (left.length !== TAG_BYTES || right.length !== TAG_BYTES) return false
  let mismatch = 0
  for (let i = 0; i < TAG_BYTES; i++) mismatch |= left[i]! ^ right[i]!
  return mismatch === 0
}

/**
 * First-time preparation only: an existing record is NEVER replaced here.
 * Caller must independently establish an authenticated account/device session
 * and require reauthentication for changes or disablement.
 */
export async function enrollPinVerifier(
  scope: PinScope,
  secret: CryptoKey,
  appPin: string,
  emergencyPin: string | null,
): Promise<void> {
  scopeId(scope)
  requireDeviceSecret(secret)
  validatePin(appPin)
  if (emergencyPin !== null) {
    validatePin(emergencyPin)
    if (emergencyPin.length !== appPin.length || emergencyPin === appPin) {
      throw new Error('pin.emergency_mismatch')
    }
  }
  const app = await buildVerifier(appPin, 'app', secret, scope)
  const emergency = emergencyPin === null
    ? null : await buildVerifier(emergencyPin, 'emergency', secret, scope)
  const timestamp = Date.now()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('pin.invalid_clock')
  }
  // Atomic add prevents concurrent tabs from resetting an enrolled verifier.
  const row: StoredPinState = {
    id: scopeId(scope), version: 1,
    accountId: scope.accountId, deviceId: scope.deviceId,
    revision: crypto.randomUUID(),
    app, emergency,
    failures: 0, lockedUntilMs: 0, lastObservedMs: timestamp,
    relockDelayMs:0, integrityTag: [],
  }
  row.integrityTag = await calculateStateTag(row, secret)
  await records.add(row)
}

/**
 * Wrong PIN attempts update one standalone IndexedDB row atomically
 * across tabs. A wrong HMAC device key fails record-integrity validation
 * without resetting any counter. No network request or plaintext PIN stored.
 * A rollback of the device wall clock fails closed until trusted time catches up.
 */
export async function attemptPinVerifier(
  scope: PinScope,
  secret: CryptoKey,
  candidate: string,
): Promise<PinAttempt> {
  const id = scopeId(scope)
  requireDeviceSecret(secret)
  const formatValid = /^[0-9]{4,8}$/.test(candidate)

  // Signing and PIN PBKDF2 are intentionally OUTSIDE the IDB transaction.
  // Holding an IDB transaction open while awaiting WebCrypto can commit it
  // prematurely. The final conditional write is short and fully atomic.
  const MAX_CAS_ATTEMPTS = 12
  for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry++) {
    const snapshot = await records.get(id)
    if (!snapshot) throw new Error('pin.not_configured')
    await verifyStoredState(snapshot, scope, secret)

    const now = Date.now()
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('pin.invalid_clock')
    }
    if (now < snapshot.lastObservedMs) return {status: 'clock-rollback'}
    if (snapshot.lockedUntilMs > now) {
      return {status: 'locked', retryAfterMs: snapshot.lockedUntilMs - now}
    }

    // Evaluate both roles before updating the ledger. A PIN matches only the
    // authenticated verifier for this exact account and device.
    const appTag = formatValid
      ? await calculateTag(
        candidate, 'app', new Uint8Array(snapshot.app.salt), secret, scope,
      ) : null
    const emergencyTag = formatValid && snapshot.emergency
      ? await calculateTag(
        candidate, 'emergency', new Uint8Array(snapshot.emergency.salt),
        secret, scope,
      ) : null
    const appMatch = appTag !== null && sameTag(appTag, snapshot.app.tag)
    const emergencyMatch = emergencyTag !== null && snapshot.emergency !== null &&
      sameTag(emergencyTag, snapshot.emergency.tag)

    const afterKdf = Date.now()
    if (!Number.isSafeInteger(afterKdf) || afterKdf < now) {
      throw new Error('pin.invalid_clock')
    }

    // Do not accept a successful PIN computed before an intervening lockout
    // or clock change. A conflict retries from a newly authenticated record.
    const row: StoredPinState = {
      ...snapshot, revision: crypto.randomUUID(),
      lastObservedMs: afterKdf,
      integrityTag: [],
    }
    let result: PinAttempt
    if (appMatch || emergencyMatch) {
      row.failures = 0
      row.lockedUntilMs = 0
      result = {status: appMatch ? 'app-unlocked' : 'emergency-intent'}
    } else {
      const priorFailures = snapshot.lockedUntilMs > 0 &&
        snapshot.lockedUntilMs <= afterKdf ? 0 : snapshot.failures
      row.failures = Math.min(MAX_FAILURES, priorFailures + 1)
      if (row.failures >= MAX_FAILURES) {
        row.lockedUntilMs = afterKdf + LOCKOUT_MS
        result = {status: 'locked', retryAfterMs: LOCKOUT_MS}
      } else {
        row.lockedUntilMs = 0
        result = {status: 'invalid', attemptsRemaining: MAX_FAILURES - row.failures}
      }
    }
    row.integrityTag = await calculateStateTag(row, secret)

    const committed = await db.transaction('rw', records, async () => {
      const current = await records.get(id)
      // Compare EVERY field as well as revision: corrupt field mutations with
      // an unchanged revision must never be overwritten by a stale signed row.
      if (!current || JSON.stringify(current) !== JSON.stringify(snapshot)) {
        return false
      }
      await records.put(row)
      return true
    })
    if (committed) return result
  }
  throw new Error('pin.concurrent_state_changed')
}


/**
 * Pure verifier construction for a future *co-located* Identity devices row.
 * This does NOT write the legacy standalone verifier database. Identity
 * migration is responsible for committing this record and encrypted package
 * together in a single IndexedDB transaction.
 */
export async function buildPinVerifierSnapshot(
  scope: PinScope,
  secret: CryptoKey,
  appPin: string,
  emergencyPin: string | null,
): Promise<StoredPinState> {
  scopeId(scope)
  requireDeviceSecret(secret)
  validatePin(appPin)
  if (emergencyPin !== null) {
    validatePin(emergencyPin)
    if (emergencyPin.length !== appPin.length || emergencyPin === appPin) {
      throw new Error('pin.emergency_mismatch')
    }
  }
  const app = await buildVerifier(appPin, 'app', secret, scope)
  const emergency = emergencyPin === null ? null :
    await buildVerifier(emergencyPin, 'emergency', secret, scope)
  const now = Date.now()
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('pin.invalid_clock')
  }
  const row: StoredPinState = {
    id: scopeId(scope), version: 1,
    accountId: scope.accountId, deviceId: scope.deviceId,
    revision: crypto.randomUUID(),
    app, emergency, failures: 0, lockedUntilMs: 0,
    lastObservedMs: now, relockDelayMs:0, integrityTag: [],
  }
  row.integrityTag = await calculateStateTag(row, secret)
  return row
}

/**
 * Compute an authenticated PIN decision entirely OUTSIDE an IndexedDB
 * transaction. The caller must atomically CAS the exact source snapshot
 * before accepting result (including successful normal PIN or emergency).
 * No writable DB is accessed by this function.
 */
export async function evaluatePinVerifierSnapshot(
  scope: PinScope,
  secret: CryptoKey,
  candidate: string,
  snapshot: StoredPinState,
): Promise<{next: StoredPinState | null; result: PinAttempt}> {
  scopeId(scope)
  requireDeviceSecret(secret)
  await verifyStoredState(snapshot, scope, secret)
  const now = Date.now()
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('pin.invalid_clock')
  }
  if (now < snapshot.lastObservedMs) {
    return {next:null, result:{status:'clock-rollback'}}
  }
  if (snapshot.lockedUntilMs > now) {
    return {
      next:null,
      result:{status:'locked',retryAfterMs:snapshot.lockedUntilMs-now},
    }
  }
  const formatValid = /^[0-9]{4,8}$/.test(candidate)
  const appTag = formatValid
    ? await calculateTag(
      candidate, 'app', new Uint8Array(snapshot.app.salt), secret, scope,
    ) : null
  const emergencyTag = formatValid && snapshot.emergency
    ? await calculateTag(
      candidate, 'emergency', new Uint8Array(snapshot.emergency.salt),
      secret, scope,
    ) : null
  const appMatch=appTag!==null&&sameTag(appTag,snapshot.app.tag)
  const emergencyMatch=emergencyTag!==null&&snapshot.emergency!==null&&
    sameTag(emergencyTag,snapshot.emergency.tag)

  const afterKdf=Date.now()
  if(!Number.isSafeInteger(afterKdf)||afterKdf<now){
    throw new Error('pin.invalid_clock')
  }
  const next:StoredPinState={
    ...snapshot,revision:crypto.randomUUID(),
    lastObservedMs:afterKdf,integrityTag:[],
  }
  let result:PinAttempt
  if(appMatch||emergencyMatch){
    next.failures=0
    next.lockedUntilMs=0
    result={status:appMatch?'app-unlocked':'emergency-intent'}
  }else{
    const priorFailures=snapshot.lockedUntilMs>0 &&
      snapshot.lockedUntilMs<=afterKdf?0:snapshot.failures
    next.failures=Math.min(MAX_FAILURES,priorFailures+1)
    if(next.failures>=MAX_FAILURES){
      next.lockedUntilMs=afterKdf+LOCKOUT_MS
      result={status:'locked',retryAfterMs:LOCKOUT_MS}
    }else{
      next.lockedUntilMs=0
      result={status:'invalid',attemptsRemaining:MAX_FAILURES-next.failures}
    }
  }
  next.integrityTag=await calculateStateTag(next,secret)
  return {next,result}
}


/**
 * VERIFY-ONLY read for an HMAC-protected timing policy.
 * The old v1 MAC has no such field and can only mean "Immediately" (0ms).
 * Does not change the active Session or authenticate user interaction.
 */
export async function readVerifiedPinRelockDelay(
  scope:PinScope,
  secret:CryptoKey,
  snapshot:StoredPinState,
):Promise<number>{
  scopeId(scope)
  requireDeviceSecret(secret)
  await verifyStoredState(snapshot,scope,secret)
  return snapshot.relockDelayMs ?? 0
}

/**
 * PURE PREPARATION only: produce a new MACed record for a future caller
 * that MUST separately establish current app-PIN reauthentication, server
 * device authority and an atomic single-row CAS with this exact snapshot.
 *
 * This function DOES NOT write a DB row or enable a settings UI. It must
 * never reset the failed-attempt/lockout ledger or accept an emergency PIN
 * as user authorization. On clock rollback or during lockout, fail closed.
 */
export async function prepareVerifiedPinRelockPolicy(
  scope:PinScope,
  secret:CryptoKey,
  snapshot:StoredPinState,
  delayMs:unknown,
):Promise<StoredPinState>{
  const desired=validPinRelockDelayMs(delayMs)
  await verifyStoredState(snapshot,scope,secret)
  const now=Date.now()
  if(!Number.isSafeInteger(now) || now<snapshot.lastObservedMs ||
     now<snapshot.lockedUntilMs)
    throw new Error('pin.policy_clock_or_lockout')
  const next:StoredPinState={
    ...snapshot,revision:crypto.randomUUID(),
    relockDelayMs:desired,lastObservedMs:now,integrityTag:[],
  }
  next.integrityTag=await calculateStateTag(next,secret)
  return next
}
