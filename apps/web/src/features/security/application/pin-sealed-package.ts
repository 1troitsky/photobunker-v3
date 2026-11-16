import {
  b64, canonical, importSigner, importSpki, sign, unb64,
  validatedPackage, verify,
} from '../../identity/infrastructure/crypto'
import type { PackageV2 } from '../../identity/infrastructure/crypto'
import type { PinScope } from './pin-verifier'

/**
 * Encryption primitive for an eventual *pre-unlock* Identity boundary.
 *
 * This does not alter existing Identity/session or local device storage. The
 * caller MUST withhold PackageV2 from activeSession until a real PIN-gated
 * bootstrap has been reviewed and must enforce PIN lockout independently.
 * An emergency PIN NEVER authorizes package decryption.
 */
export type PinSealedPackage = Readonly<{
  v: 1
  alg: 'PBKDF2-SHA256+A256GCM+A256GCM'
  purpose: 'preunlock-package'
  accountId: string
  deviceId: string
  packageRevision: number
  salt: string
  pinIv: string
  deviceIv: string
  ciphertext: string
}>

const ITERATIONS = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', {fatal: true})
const SALT_SIZE = 32
const IV_SIZE = 12
const MAX_CIPHERTEXT = 6144
const ALGORITHM = 'PBKDF2-SHA256+A256GCM+A256GCM' as const
const PURPOSE = 'preunlock-package' as const
const KEYS = [
  'accountId', 'alg', 'ciphertext', 'deviceId', 'deviceIv',
  'packageRevision', 'pinIv', 'purpose', 'salt', 'v',
].sort().join('|')

function validScope(scope: PinScope): void {
  if (!scope || !/^[a-zA-Z0-9-]{8,64}$/.test(scope.accountId) ||
      !/^[a-zA-Z0-9-]{8,64}$/.test(scope.deviceId)) {
    throw new Error('pin.invalid_scope')
  }
}

function validPin(pin: string): void {
  if (typeof pin !== 'string' || !/^[0-9]{4,8}$/.test(pin)) {
    throw new Error('pin.invalid_format')
  }
}

function validDeviceKey(key: CryptoKey): void {
  const alg = key?.algorithm as AesKeyAlgorithm | undefined
  if (!alg || alg.name !== 'AES-GCM' || alg.length !== 256 ||
      key.extractable ||
      !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
    throw new Error('pin.invalid_device_key')
  }
}

function aad(
  layer: 'pin' | 'device', frame: Omit<PinSealedPackage, 'ciphertext'>,
): Uint8Array<ArrayBuffer> {
  // Canonical fixed-array schema (no JSON key-order ambiguity).
  return enc.encode(JSON.stringify([
    'PB3/PIN/Package/v1', layer, frame.v, frame.alg, frame.purpose,
    frame.accountId, frame.deviceId, frame.packageRevision,
    frame.salt, frame.pinIv, frame.deviceIv,
  ]))
}

async function derivePinKey(
  pin: string, salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey({
    name: 'PBKDF2', hash: 'SHA-256',
    salt, iterations: ITERATIONS,
  }, source, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt'])
}

function validateEnvelope(input: unknown, scope: PinScope, revision: number): PinSealedPackage {
  validScope(scope)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('pin.invalid_package_envelope')
  }
  const e = input as Record<string, unknown>
  if (Object.keys(e).sort().join('|') !== KEYS ||
      e.v !== 1 || e.alg !== ALGORITHM || e.purpose !== PURPOSE ||
      e.accountId !== scope.accountId || e.deviceId !== scope.deviceId ||
      !Number.isSafeInteger(e.packageRevision) ||
      (e.packageRevision as number) < 1 ||
      e.packageRevision !== revision ||
      typeof e.salt !== 'string' || typeof e.pinIv !== 'string' ||
      typeof e.deviceIv !== 'string' || typeof e.ciphertext !== 'string' ||
      e.ciphertext.length > MAX_CIPHERTEXT || e.ciphertext.length < 24) {
    throw new Error('pin.invalid_package_envelope')
  }
  try {
    unb64(e.salt, SALT_SIZE)
    unb64(e.pinIv, IV_SIZE)
    unb64(e.deviceIv, IV_SIZE)
    if (unb64(e.ciphertext).byteLength > MAX_CIPHERTEXT) {
      throw new Error('pin.invalid_package_envelope')
    }
  } catch {
    throw new Error('pin.invalid_package_envelope')
  }
  return e as PinSealedPackage
}

async function validateSigningPackage(pkg: PackageV2): Promise<void> {
  // Existing valid-package shape alone does not prove that private/public
  // signing material match. Verify real key ownership in both directions.
  try {
    const signer = await importSigner(pkg.accountPkcs8)
    const verifier = await importSpki(pkg.accountSpki)
    const probe = 'PB3/PIN/Package/v1/' + pkg.accountId + '/' + pkg.revision
    if (!(await verify(verifier, probe, await sign(signer, probe)))) {
      throw new Error('pin.invalid_package_keypair')
    }
  } catch {
    throw new Error('pin.invalid_package_keypair')
  }
}

/**
 * Build an encrypted *alternative* to a plaintext/device-only account package.
 * Storage/activation of this envelope belongs to a separate audited Identity
 * change; a caller retaining the original package defeats PIN gating.
 */
export async function sealPinProtectedPackage(
  pkgInput: PackageV2,
  scope: PinScope,
  appPin: string,
  deviceKey: CryptoKey,
): Promise<PinSealedPackage> {
  validScope(scope)
  validPin(appPin)
  validDeviceKey(deviceKey)
  const pkg = validatedPackage(pkgInput, scope.accountId)
  await validateSigningPackage(pkg)
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE))
  const pinIv = crypto.getRandomValues(new Uint8Array(IV_SIZE))
  const deviceIv = crypto.getRandomValues(new Uint8Array(IV_SIZE))
  const frame = {
    v: 1 as const, alg:ALGORITHM, purpose:PURPOSE,
    accountId:scope.accountId, deviceId:scope.deviceId,
    packageRevision:pkg.revision, salt:b64(salt), pinIv:b64(pinIv),
    deviceIv:b64(deviceIv),
  }
  const clear = enc.encode(canonical(pkg as unknown as Record<string, unknown>))
  if (clear.byteLength > 3072) {
    clear.fill(0)
    throw new Error('pin.package_too_large')
  }
  let inner: Uint8Array<ArrayBuffer> | null = null
  try {
    const pinKey = await derivePinKey(appPin, salt)
    inner = new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM', iv:pinIv, additionalData:aad('pin',frame),
      tagLength:128,
    },pinKey,clear))
    const outer = new Uint8Array(await crypto.subtle.encrypt({
      name:'AES-GCM', iv:deviceIv, additionalData:aad('device',frame),
      tagLength:128,
    },deviceKey,inner))
    return {...frame,ciphertext:b64(outer)}
  } finally {
    clear.fill(0)
    inner?.fill(0)
  }
}

/**
 * A decryption helper, NOT an unlocked-session capability. A future caller
 * must first enforce the authenticated PIN failure ledger, require an active
 * trusted device, and atomically gate *all* downstream package consumers.
 */
export async function openPinProtectedPackage(
  input: unknown,
  scope: PinScope,
  appPin: string,
  deviceKey: CryptoKey,
  expectedRevision: number,
): Promise<PackageV2> {
  validScope(scope)
  validPin(appPin)
  validDeviceKey(deviceKey)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('pin.invalid_revision')
  }
  const frame = validateEnvelope(input, scope, expectedRevision)
  let inner: Uint8Array<ArrayBuffer> | null = null
  let clear: Uint8Array<ArrayBuffer> | null = null
  try {
    const salt = unb64(frame.salt, SALT_SIZE)
    const pinIv = unb64(frame.pinIv, IV_SIZE)
    const deviceIv = unb64(frame.deviceIv, IV_SIZE)
    inner = new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM', iv:deviceIv,
      additionalData:aad('device',frame),tagLength:128,
    },deviceKey,unb64(frame.ciphertext)))
    const pinKey = await derivePinKey(appPin,salt)
    clear = new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:pinIv,
      additionalData:aad('pin',frame),tagLength:128,
    },pinKey,inner))
    if (clear.byteLength > 3072) throw new Error('pin.package_unavailable')
    const pkg = validatedPackage(JSON.parse(dec.decode(clear)),scope.accountId)
    if (pkg.revision !== expectedRevision) throw new Error('pin.package_unavailable')
    await validateSigningPackage(pkg)
    return pkg
  } catch {
    // Do not distinguish wrong PIN, wrong key, tampering or corrupt payload.
    throw new Error('pin.package_unavailable')
  } finally {
    inner?.fill(0)
    clear?.fill(0)
  }
}
