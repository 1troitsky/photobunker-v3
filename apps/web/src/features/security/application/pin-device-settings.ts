import {activeSession} from '../../identity/application/session'
import {canonical,sealDevice} from '../../identity/infrastructure/crypto'
import type {PackageV2} from '../../identity/infrastructure/crypto'
import {getDevice,openIdentityDB} from '../../identity/infrastructure/storage'
import type {LocalDevice} from '../../identity/infrastructure/storage'
import {admitCoLocatedPinDevice} from './pin-device-admission'
import {sealPinProtectedPackage} from './pin-sealed-package'
import {buildPinVerifierSnapshot,prepareVerifiedPinRelockPolicy} from './pin-verifier'
import type {PinScope} from './pin-verifier'
import type {SealedPinDevice} from './pin-device-migration'
import {withExclusivePinMigration} from './pin-session-lease'
import {publishPinDeviceSealed} from './pin-tab-fence'

export type PinSettingsChange={kind:'change';newPin:string}|{kind:'disable'}|{kind:'delay';delayMs:number}
/** Caller closes its live lease and independently verifies online device authority.
 * The old PIN is ALWAYS verified using the durable HMAC lockout ledger before
 * decrypting a package. One exclusive lease and one CAS protect the replacement.
 */
export async function replacePinSettings(input:{scope:PinScope;candidate:string;expectedPackage:PackageV2;change:PinSettingsChange;isCurrent:()=>boolean}):Promise<LocalDevice>{
  const current=()=>{if(activeSession.value||!input.isCurrent())throw Error('pin.session_changed')}
  current()
  return withExclusivePinMigration(input.scope,async()=>{
    current()
    const nonce=crypto.randomUUID()
    const admission=await admitCoLocatedPinDevice({scope:input.scope,candidate:input.candidate,readTrustedContext:()=>input.isCurrent()&&!activeSession.value?{...input.scope,sessionNonce:nonce,packageRevision:input.expectedPackage.revision}:null})
    if(admission.status!=='unlocked')throw Error('pin.'+admission.status)
    current()
    if(canonical(admission.pkg as unknown as Record<string,unknown>)!==canonical(input.expectedPackage as unknown as Record<string,unknown>))throw Error('pin.package_mismatch')
    const row=await getDevice(input.scope.accountId,input.scope.deviceId) as SealedPinDevice|undefined
    if(!row||row.pinMode!=='pin-v1')throw Error('pin.device_changed')
    let next:LocalDevice
    if(input.change.kind==='disable'){
      const {pinMode:_mode,pinVerifier:_verifier,pinHmacKey:_hmac,pinLength:_length,envelope:_envelope,...device}=row
      next={...device,envelope:await sealDevice(admission.pkg,row.deviceId,row.encryptionKey)}
    }else if(input.change.kind==='change'){
      const envelope=await sealPinProtectedPackage(admission.pkg,input.scope,input.change.newPin,row.encryptionKey)
      const hmac=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign'])
      const verifier=await buildPinVerifierSnapshot(input.scope,hmac,input.change.newPin,null)
      next={...row,envelope,pinHmacKey:hmac,pinVerifier:verifier,pinLength:input.change.newPin.length} as unknown as LocalDevice
    }else{
      const verifier=await prepareVerifiedPinRelockPolicy(input.scope,row.pinHmacKey,row.pinVerifier,input.change.delayMs)
      next={...row,pinVerifier:verifier} as unknown as LocalDevice
    }
    current()
    const db=await openIdentityDB()
    try{await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['devices','sessions'],'readwrite'),store=tx.objectStore('devices')
      let reason:Error|null=null
      const request=store.get(input.scope.deviceId),sessions=tx.objectStore('sessions').getAll()
      let count=2
      const replace=()=>{
        if(--count)return
        try{
          current();const latest=request.result as SealedPinDevice|undefined
          if(!latest||latest.pinMode!=='pin-v1'||latest.accountId!==input.scope.accountId
            ||latest.deviceSpki!==row.deviceSpki||JSON.stringify(latest.pinVerifier)!==JSON.stringify(row.pinVerifier)
            ||canonical(latest.envelope as unknown as Record<string,unknown>)!==canonical(row.envelope as unknown as Record<string,unknown>)
            ||(sessions.result as Array<{deviceId?:string;signedOut?:boolean}>).some(s=>s.deviceId===input.scope.deviceId&&s.signedOut))throw Error('pin.device_changed')
          store.put(next)
        }catch(e){reason=e instanceof Error?e:Error('pin.storage_failed');tx.abort()}
      }
      request.onsuccess=replace;sessions.onsuccess=replace
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(reason??tx.error??Error('pin.storage_failed'))
    })}finally{db.close()}
    publishPinDeviceSealed(input.scope)
    return next
  })
}
