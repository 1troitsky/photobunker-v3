import type { PinScope } from './pin-verifier'
import type { PinPackageAdmission, TrustedPinContext } from './pin-package-admission'
import {
  attemptSealedPinDevice, readSealedDeviceWithReceipt,
} from './pin-device-migration'
import { openPinProtectedPackage } from './pin-sealed-package'

function checkedContext(
  read:()=>TrustedPinContext|null,
  expected?:TrustedPinContext,
):TrustedPinContext{
  let ctx:TrustedPinContext|null
  try{ctx=read()}catch{throw new Error('pin.session_unavailable')}
  if(!ctx ||
     !/^[A-Za-z0-9-]{8,64}$/.test(ctx.accountId)||
     !/^[A-Za-z0-9-]{8,64}$/.test(ctx.deviceId)||
     !Number.isSafeInteger(ctx.packageRevision)||
     ctx.packageRevision<1||
     !/^[A-Za-z0-9_-]{16,128}$/.test(ctx.sessionNonce))
    throw new Error('pin.session_unavailable')
  if(expected && (ctx.accountId!==expected.accountId||
      ctx.deviceId!==expected.deviceId||
      ctx.packageRevision!==expected.packageRevision||
      ctx.sessionNonce!==expected.sessionNonce))
    throw new Error('pin.session_changed')
  return Object.freeze({
    accountId:ctx.accountId,deviceId:ctx.deviceId,
    packageRevision:ctx.packageRevision,sessionNonce:ctx.sessionNonce,
  })
}

/**
 * UNWIRED local Identity-v2 PIN admission. PIN ledger and sealed ciphertext
 * live atomically in the same device row; no second IndexedDB required.
 * The verifier CAS must commit before any AES-GCM package decryption.
 *
 * This does NOT prove that readTrustedContext has independent authority or
 * that existing Identity.resumeLocalDevice (legacy path) is PIN-gated. Future
 * integration must prevent all pre-PIN PackageV2 access in all tabs.
 */
export async function admitCoLocatedPinDevice(args:Readonly<{
  scope:PinScope
  candidate:string
  readTrustedContext:()=>TrustedPinContext|null
}>):Promise<PinPackageAdmission>{
  const first=checkedContext(args.readTrustedContext)
  if(args.scope.accountId!==first.accountId||
     args.scope.deviceId!==first.deviceId)
    throw new Error('pin.session_changed')
  const response=await attemptSealedPinDevice(args.scope,args.candidate)
  checkedContext(args.readTrustedContext,first)
  if(response.result.status!=='app-unlocked')return response.result
  if(!response.receiptRevision)throw new Error('pin.invalid_receipt')

  const stored=await readSealedDeviceWithReceipt(
    args.scope,response.receiptRevision,
  )
  checkedContext(args.readTrustedContext,first)
  const pkg=await openPinProtectedPackage(
    stored.encrypted,args.scope,args.candidate,
    stored.envelopeDeviceAes,first.packageRevision,
  )
  checkedContext(args.readTrustedContext,first)
  // Another concurrent failed PIN or migration must invalidate this unlock.
  await readSealedDeviceWithReceipt(args.scope,response.receiptRevision)
  if(pkg.accountId!==first.accountId||pkg.revision!==first.packageRevision)
    throw new Error('pin.package_session_mismatch')
  return {status:'unlocked',pkg}
}
