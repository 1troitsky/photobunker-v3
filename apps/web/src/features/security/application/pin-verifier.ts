import Dexie from 'dexie'

/**
 * Offline PIN check only. This is NOT session authorization and must never directly
 * unlock account keys or execute the emergency/Panic workflow.
 *
 * A non-extractable high-entropy HMAC key must be supplied by a separately verified
 * device/account session and must NEVER be saved beside the local verifier.
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

type StoredPinState = {
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
      algorithm.hash?.name !== 'SHA-256' ||
      !secret.usages.includes('sign')) {
    throw new Error('pin.invalid_device_secret')
  }
}

function validateVerifier(verifier: StoredVerifier | null): void {
  if (verifier === null) return
  if (!Array.isArray(verifier.salt) || verifier.salt.length !== SALT_BYTES ||
      !Array.isArray(verifier.tag) || verifier.tag.length !== TAG_BYTES ||
      ![...verifier.salt, ...verifier.tag].every(
        n => Number.isInteger(n) && n >= 0 && n <= 255,
      )) {
    throw new Error('pin.corrupt_record')
  }
}

function validateState(row: StoredPinState, scope: PinScope): void {
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
  validateVerifier(row.emergency)
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
  await records.add({
    id: scopeId(scope), version: 1,
    accountId: scope.accountId, deviceId: scope.deviceId,
    revision: crypto.randomUUID(),
    app, emergency,
    failures: 0, lockedUntilMs: 0, lastObservedMs: timestamp,
  })
}

/**
 * Failed attempts (including wrong device keys) update one IndexedDB row
 * atomically across tabs. No network request, plaintext PIN or HMAC key stored.
 * A rollback of the device wall clock fails closed until trusted time catches up.
 */
export async function attemptPinVerifier(
  scope: PinScope,
  secret: CryptoKey,
  candidate: string,
): Promise<PinAttempt> {
  const id = scopeId(scope)
  requireDeviceSecret(secret)
  const now = Date.now()
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('pin.invalid_clock')
  }
  const snapshot = await records.get(id)
  if (!snapshot) throw new Error('pin.not_configured')
  validateState(snapshot, scope)

  // PBKDF2 is deliberately done BEFORE the IDB transaction: holding a Dexie
  // transaction open across WebCrypto awaits can make it inactive/commit early.
  // Both MACs are computed even on a match to avoid exposing the PIN role
  // through early-return timing. All state updates remain in a single rw TX.
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

  return db.transaction('rw', records, async (): Promise<PinAttempt> => {
    const row = await records.get(id)
    if (!row) throw new Error('pin.not_configured')
    validateState(row, scope)
    if (row.revision !== snapshot.revision ||
        JSON.stringify(row.app) !== JSON.stringify(snapshot.app) ||
        JSON.stringify(row.emergency) !== JSON.stringify(snapshot.emergency)) {
      throw new Error('pin.state_changed')
    }
    if (now < row.lastObservedMs) return {status: 'clock-rollback'}
    if (row.lockedUntilMs > now) {
      return {status: 'locked', retryAfterMs: row.lockedUntilMs - now}
    }

    row.lastObservedMs = now
    const appMatch = appTag !== null && sameTag(appTag, row.app.tag)
    const emergencyMatch = emergencyTag !== null && row.emergency !== null &&
      sameTag(emergencyTag, row.emergency.tag)

    if (appMatch || emergencyMatch) {
      row.failures = 0
      row.lockedUntilMs = 0
      await records.put(row)
      return {status: appMatch ? 'app-unlocked' : 'emergency-intent'}
    }

    row.failures = row.lockedUntilMs === 0 || row.lockedUntilMs <= now
      ? Math.min(MAX_FAILURES, row.failures + 1) : row.failures
    if (row.failures >= MAX_FAILURES) {
      row.lockedUntilMs = now + LOCKOUT_MS
      await records.put(row)
      return {status: 'locked', retryAfterMs: LOCKOUT_MS}
    }
    row.lockedUntilMs = 0
    await records.put(row)
    return {status: 'invalid', attemptsRemaining: MAX_FAILURES - row.failures}
  })
}
