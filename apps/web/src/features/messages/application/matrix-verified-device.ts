import type {CryptoApi} from 'matrix-js-sdk/lib/crypto-api'
import {activeSession,requireSession} from '../../identity/application/session'
import {getBoundMatrixCredentials} from './matrix-binding'
import {getMatrixContactMapping} from './matrix-peer-identity'

/**
 * P2-02D3. Revalidate a previously PB3-signed Contact/MXID against
 * independently approved Matrix Ed25519 device fingerprint and actual
 * *cross-signing* trust. Never setDeviceVerified, pinCurrentUserIdentity,
 * crossSignDevice or send from this inspection.
 *
 * Returns a read-only proof only. Before any future send, also require a
 * live syncing client, room membership/ACL and verified key-backup setup.
 */
export type InspectedMatrixDevice={
  matrixUserId:string
  matrixDeviceId:string
  matrixEd25519:string
  crossSigningChecked:true
  capability:'inspection-only-no-send'
}
const mxKey=/^[A-Za-z0-9+/_=-]{30,90}$/
const mxDevice=/^[\x21-\x7e]{1,128}$/

export async function inspectVerifiedMatrixDevice(
  peerAccountId:string,
  independentlyApprovedEd25519:string,
  crypto:Pick<CryptoApi,
  'userHasCrossSigningKeys'|'getUserDeviceInfo'|
  'getUserVerificationStatus'|'getDeviceVerificationStatus'>,
):Promise<InspectedMatrixDevice>{
  const session=requireSession()
  if(!session.online||(typeof navigator!=='undefined'&&navigator.onLine===false))
    throw Error('matrix.trust_offline')
  if(!mxKey.test(independentlyApprovedEd25519))
    throw Error('matrix.trust_missing_independent_fingerprint')
  const current=()=>{
    const now=activeSession.value
    if(!now||!now.online||now.accountId!==session.accountId
      ||now.deviceId!==session.deviceId
      ||now.pkg.revision!==session.pkg.revision
      ||now.pkg.akek!==session.pkg.akek
      ||now.pkg.accountSpki!==session.pkg.accountSpki)
      throw Error('matrix.trust_session_changed')
  }
  const mapping=await getMatrixContactMapping(peerAccountId)
  current()
  if(!mapping||mapping.verification!=='pb3-account-signed-only'
    ||!mxDevice.test(mapping.matrixDeviceId))
    throw Error('matrix.trust_contact_not_confirmed')
  const my=await getBoundMatrixCredentials()
  current()
  if(!my||my.contract.accountId!==session.accountId
    ||my.contract.pb3DeviceId!==session.deviceId
    ||my.contract.homeserverUrl!==mapping.homeserverUrl
    ||my.contract.matrixUserId===mapping.matrixUserId)
    throw Error('matrix.trust_binding_mismatch')

  try{
    const user=mapping.matrixUserId
    // Never equate the PB3 signature, a nickname, TOFU or locally
    // marked-verified Matrix device with cross-signing verification.
    if(await crypto.userHasCrossSigningKeys(user,true)!==true)
      throw Error('matrix.trust_no_cross_signing')
    current()
    const userTrust=await crypto.getUserVerificationStatus(user)
    current()
    if(!userTrust.known||userTrust.needsUserApproval
      ||!userTrust.isCrossSigningVerified())
      throw Error('matrix.trust_unverified_user')
    // SDK waits on stale key queries, and downloads unknown peers on demand.
    const deviceLists=await crypto.getUserDeviceInfo([user],true)
    current()
    const devices=deviceLists.get(user)
    if(!devices?.size||!devices.has(mapping.matrixDeviceId))
      throw Error('matrix.trust_device_missing')
    for(const [deviceId,device] of devices){
      if(device.userId!==user||device.deviceId!==deviceId
        ||!mxDevice.test(deviceId)
        ||!device.getFingerprint()||!device.getIdentityKey()
        ||!device.algorithms.includes('m.olm.v1.curve25519-aes-sha2')
        ||!device.algorithms.includes('m.megolm.v1.aes-sha2'))
        throw Error('matrix.trust_device_missing_keys')
      const state=await crypto.getDeviceVerificationStatus(user,deviceId)
      current()
      // A local "verified" flag without owner's cross-signature is
      // intentionally insufficient. Every current recipient device must
      // be cross-signed, otherwise a room key could reach an impostor.
      if(!state||!state.signedByOwner||!state.crossSigningVerified
        ||!state.isVerified())
        throw Error('matrix.trust_unverified_device')
    }
    const chosen=devices.get(mapping.matrixDeviceId)!
    if(chosen.getFingerprint()!==independentlyApprovedEd25519)
      throw Error('matrix.trust_ed25519_changed')
    current()
    return {
      matrixUserId:user,matrixDeviceId:mapping.matrixDeviceId,
      matrixEd25519:independentlyApprovedEd25519,
      crossSigningChecked:true,
      capability:'inspection-only-no-send',
    }
  }catch(e){
    if(e instanceof Error&&e.message.startsWith('matrix.'))throw e
    throw Error('matrix.trust_verification_unavailable')
  }
}
