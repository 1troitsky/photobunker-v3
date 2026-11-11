import {activeSession,requireSession,logout} from './session'
import type {Session} from './session'
import {jsonApi} from '../infrastructure/api'
import {importSigner,sign,uuid} from '../infrastructure/crypto'
import {clearLocalMatrixCredentials} from '../../messages/application/matrix-binding'
import {prepareOwnMatrixTokenLogout} from '../../messages/application/matrix-self-logout'

const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
type Device={id:string;created_at:string;revoked_at:string|null}
type DeviceList={devices:Device[]}
type Revoked={
  pb3Revoked:true
  unchanged:boolean
  matrixRemoteRevoked:false
  matrixRevocationStatus:'not_performed'
}
export type DeviceRevokeResult=Revoked&{
  localMatrixCredentialsCleared:boolean
  localMatrixShutdownComplete:boolean
  matrixOwnTokenLogout:'confirmed'|'unconfirmed'|'not_attempted'
}

function same(s:Session):void{
  const cur=activeSession.value
  if(!cur||cur.accountId!==s.accountId||cur.deviceId!==s.deviceId
    ||cur.pkg.revision!==s.pkg.revision
    ||cur.pkg.akek!==s.pkg.akek
    ||cur.pkg.accountSpki!==s.pkg.accountSpki)
    throw Error('identity.revoke_session_changed')
}
function online():Session{
  const s=requireSession()
  if(!s.online)throw Error('identity.revoke_requires_online')
  return s
}

/** Only server-reported devices; never infer remote Matrix token status. */
export async function listPB3Devices():Promise<Device[]>{
  const s=online()
  const data=await jsonApi<DeviceList>('/identity/v2/devices')
  same(s)
  if(!data||!Array.isArray(data.devices)
    ||data.devices.length>5000
    ||data.devices.some(d=>!d||typeof d.id!=='string'
      ||!uuidRe.test(d.id)||typeof d.created_at!=='string'
      ||(d.revoked_at!==null&&typeof d.revoked_at!=='string')))
    throw Error('identity.invalid_device_list')
  return data.devices
}

/** This ONLY revokes PB3 authorization. No remote Matrix token revoke is
 * possible from PB3 without a separately approved delegated Matrix auth.
 * Call only after explicit user confirmation with visible scope warning.
 */
export async function revokePB3Device(targetDeviceId:string
):Promise<DeviceRevokeResult>{
  if(!uuidRe.test(targetDeviceId))throw Error('identity.revoke_bad_device_id')
  const s=online()
  // Prepare before server-side PB3 revocation makes /matrix/v1/me reject
  // this browser's cookie. Remote Matrix requests run only AFTER the signed
  // PB3 revocation commits. A broken Matrix service must not block PB3 revoke.
  let matrixLogout:(()=>Promise<boolean>)|null=null
  let matrixPreparationFailed=false
  if(targetDeviceId===s.deviceId){
    try{matrixLogout=await prepareOwnMatrixTokenLogout()}
    catch{matrixPreparationFailed=true}
    same(s)
  }
  const contract=JSON.stringify({
    version:1,operationId:uuid(),accountId:s.accountId,
    actorDeviceId:s.deviceId,targetDeviceId,accountRevision:s.pkg.revision,
  })
  const message='pb3.identity-device-revoke.v1\n'+contract
  const [accountSignature,deviceSignature]=await Promise.all([
    sign(await importSigner(s.pkg.accountPkcs8),message),
    sign(s.device.deviceKey,message),
  ])
  same(s)
  const result=await jsonApi<Revoked>(
    '/identity/v2/devices/'+targetDeviceId+'/revoke','POST',{
      contract,accountSignature,deviceSignature,
    },
  )
  same(s)
  if(result?.pb3Revoked!==true||typeof result.unchanged!=='boolean'
    ||result.matrixRemoteRevoked!==false
    ||result.matrixRevocationStatus!=='not_performed')
    throw Error('identity.revoke_ack_unverified')

  // Revoking a different device leaves this browser's Matrix runtime
  // untouched. PB3 server-side authorization is denied for the target
  // from the moment the transaction commits, not its Matrix bearer token.
  if(targetDeviceId!==s.deviceId)return {
    ...result,localMatrixCredentialsCleared:false,
    localMatrixShutdownComplete:false,
    matrixOwnTokenLogout:'not_attempted',
  }
  let stopped=true,cleared=true
  let matrixOwnTokenLogout:'confirmed'|'unconfirmed'|'not_attempted'=
    matrixPreparationFailed?'unconfirmed':'not_attempted'
  try{
    // Do not load the 7.8 MB Matrix RustCrypto WASM on ordinary PB3
    // settings/identity startup. Matrix stays an explicit lazy capability.
    const {stopMatrixCrypto}=await import('../../messages/application/matrix-rust-adapter')
    await stopMatrixCrypto()
  }catch{stopped=false}
  if(matrixLogout){
    // A Synapse logout ACK is not sufficient: the same bearer must now
    // fail /account/whoami with HTTP 401. No claims about OTHER devices.
    try{matrixOwnTokenLogout=await matrixLogout()?'confirmed':'unconfirmed'}
    catch{matrixOwnTokenLogout='unconfirmed'}
  }
  try{await clearLocalMatrixCredentials()}catch{cleared=false}
  // Server-side self-revocation has already completed. Always lock PB3,
  // even if local Matrix cleanup fails; NEVER claim a remote Matrix wipe.
  await logout()
  return {...result,
    localMatrixCredentialsCleared:cleared,
    localMatrixShutdownComplete:stopped,
    matrixOwnTokenLogout,
  }
}
