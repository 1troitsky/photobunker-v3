import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {getBoundMatrixCredentials} from './matrix-binding'

/**
 * M-03B: best-effort logout of THIS browser's Matrix bearer only, after a
 * successful signed PB3 self-revocation. Never accepts an arbitrary origin,
 * MXID or token from the caller; never claims another device was logged out.
 * The returned closure is ephemeral and must never be persisted or logged.
 */
type MatrixMe={
  bound:boolean;homeserverUrl:string;matrixUserId:string|null
  deviceBinding?:{contract:string}|null
}
const allowedOrigin=/^https:\/\/[a-z0-9][a-z0-9.-]*(?::443)?$/
function unchanged(s:Session):boolean{
  const current=activeSession.value
  return Boolean(current&&current.accountId===s.accountId
    &&current.deviceId===s.deviceId
    &&current.pkg.akek===s.pkg.akek
    &&current.pkg.accountSpki===s.pkg.accountSpki
    &&current.pkg.revision===s.pkg.revision)
}
type PrepareResult=(()=>Promise<boolean>)|null

export async function prepareOwnMatrixTokenLogout():Promise<PrepareResult>{
  const s=requireSession()
  if(!s.online)throw Error('matrix.self_logout_pb3_offline')
  const local=await getBoundMatrixCredentials()
  if(!unchanged(s))throw Error('matrix.self_logout_session_changed')
  if(!local)return null
  const {contract,accessToken}=local
  // A sealed local token does not imply an active PB3-authorized binding.
  // Verify against the signed authoritative PB3 ledger before capturing it.
  const server=await jsonApi<MatrixMe>('/matrix/v1/me')
  if(!unchanged(s))throw Error('matrix.self_logout_session_changed')
  if(!server.bound||server.homeserverUrl!==contract.homeserverUrl
    ||server.matrixUserId!==contract.matrixUserId
    ||server.deviceBinding?.contract!==JSON.stringify(contract)
    ||!allowedOrigin.test(contract.homeserverUrl))
    throw Error('matrix.self_logout_binding_unverified')

  const url=contract.homeserverUrl+'/_matrix/client/v3'
  // Bound all network work so a failed homeserver cannot hold PB3 logout.
  return async()=>{
    if(!unchanged(s))return false
    const abort=new AbortController()
    const timer=setTimeout(()=>abort.abort(),5000)
    const options={
      credentials:'omit' as const,cache:'no-store' as const,
      redirect:'error' as const,signal:abort.signal,
    }
    const headers={Authorization:'Bearer '+accessToken}
    try{
      const before=await fetch(url+'/account/whoami',{...options,headers})
      if(!before.ok)return false
      const identity=await before.json() as {
        user_id?:string;device_id?:string;is_guest?:boolean
      }
      if(identity.user_id!==contract.matrixUserId
        ||identity.device_id!==contract.matrixDeviceId
        ||identity.is_guest===true||!unchanged(s))return false
      const logout=await fetch(url+'/logout',{
        ...options,method:'POST',
        headers:{...headers,'Content-Type':'application/json'},body:'{}',
      })
      if(!logout.ok)return false
      // A 200 for /logout is not evidence of revocation by itself.
      // The exact same bearer must now be rejected by the homeserver.
      const after=await fetch(url+'/account/whoami',{...options,headers})
      return after.status===401
    }catch{return false}
    finally{clearTimeout(timer)}
  }
}
