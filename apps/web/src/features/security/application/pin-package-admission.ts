import type { PackageV2 } from '../../identity/infrastructure/crypto'
import type { PinScope } from './pin-verifier'
import { attemptPinVerifier } from './pin-verifier'
import { openPinProtectedPackage } from './pin-sealed-package'

/**
 * An unwired application-layer admission helper for a future PIN-aware
 * pre-unlock bootstrap. NOT an Identity gate: existing Identity still opens
 * its own device envelope before this code is ever invoked.
 *
 * readTrustedContext MUST be supplied by a separately authenticated session
 * authority. A mutable UI state value or locally attacker-controlled session
 * nonce cannot be treated as proof of device authorization.
 */
export type TrustedPinContext = Readonly<{
  accountId: string
  deviceId: string
  packageRevision: number
  /** Distinct nonce for every authenticated session incarnation. */
  sessionNonce: string
}>

type DeniedAdmission =
  | {status:'invalid'; attemptsRemaining:number}
  | {status:'locked'; retryAfterMs:number}
  | {status:'clock-rollback'}
  | {status:'emergency-intent'}

export type PinPackageAdmission =
  | DeniedAdmission
  | {status:'unlocked'; pkg:PackageV2}

function validContext(value: TrustedPinContext | null): value is TrustedPinContext {
  return value !== null &&
    /^[a-zA-Z0-9-]{8,64}$/.test(value.accountId) &&
    /^[a-zA-Z0-9-]{8,64}$/.test(value.deviceId) &&
    Number.isSafeInteger(value.packageRevision) &&
    value.packageRevision >= 1 &&
    /^[A-Za-z0-9_-]{16,128}$/.test(value.sessionNonce)
}

function unchanged(a:TrustedPinContext,b:TrustedPinContext|null):boolean {
  return validContext(b) &&
    b.accountId === a.accountId &&
    b.deviceId === a.deviceId &&
    b.packageRevision === a.packageRevision &&
    b.sessionNonce === a.sessionNonce
}

function readTrusted(
  getCurrent:()=>TrustedPinContext|null,
  expected?:TrustedPinContext,
):TrustedPinContext {
  let current:TrustedPinContext|null
  try {
    current=getCurrent()
  } catch {
    throw new Error('pin.session_unavailable')
  }
  if (!validContext(current)) throw new Error('pin.session_unavailable')
  if (expected && !unchanged(expected,current)) {
    throw new Error('pin.session_changed')
  }
  // Copy scalars before any async work. A caller may reuse and mutate the
  // same context object; retaining its reference would make both comparisons
  // see the changed values and silently defeat the session fence.
  return Object.freeze({
    accountId:current.accountId,
    deviceId:current.deviceId,
    packageRevision:current.packageRevision,
    sessionNonce:current.sessionNonce,
  })
}

/**
 * Offline candidate verifier must run BEFORE package decryption.
 * The only possible package-bearing result is 'unlocked', after a normal PIN
 * match, authenticated device AES-GCM unwrap and two identity-fence checks.
 * Emergency PIN is *intent only*; NEVER decrypts or initiates Panic.
 *
 * A real app MUST make openPinProtectedPackage unreachable except through an
 * audited PIN-aware Identity bootstrap, and must prevent simultaneous wrong
 * guesses during the final async handoff. This helper alone is NOT security
 * isolation or proof of trusted device revocation / secure clock.
 */
export async function admitPinProtectedPackage(args:Readonly<{
  encryptedPackage:unknown
  candidate:string
  verifierDeviceHmac:CryptoKey
  envelopeDeviceAes:CryptoKey
  readTrustedContext:()=>TrustedPinContext|null
}>):Promise<PinPackageAdmission> {
  // Establish a trusted snapshot BEFORE even reading an IndexedDB verifier.
  const start = readTrusted(args.readTrustedContext)
  const scope:PinScope = {
    accountId:start.accountId,
    deviceId:start.deviceId,
  }
  const check = await attemptPinVerifier(
    scope,args.verifierDeviceHmac,args.candidate,
  )
  readTrusted(args.readTrustedContext,start)
  if (check.status !== 'app-unlocked') {
    // In particular, Emergency PIN must not retrieve a PackageV2 or
    // accidentally unlock access to any secure media.
    return check
  }

  const pkg=await openPinProtectedPackage(
    args.encryptedPackage,scope,args.candidate,
    args.envelopeDeviceAes,start.packageRevision,
  )
  readTrusted(args.readTrustedContext,start)

  if (pkg.accountId !== start.accountId ||
      pkg.revision !== start.packageRevision) {
    throw new Error('pin.package_session_mismatch')
  }
  return {status:'unlocked',pkg}
}
