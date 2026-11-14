/**
 * Cooperative Web Locks gate for one exact key-only Identity device.
 *
 * - An ACTIVE, decrypted Session holds a SHARED browser lock.
 * - An as-yet UNRELEASED legacy->PIN migration needs an EXCLUSIVE
 *   non-waiting lock over validation, KDF and the atomic IndexedDB swap.
 * - Older/uncooperative tabs, workers, previously copied keys, and a
 *   compromised origin are OUTSIDE this guarantee. No Web Locks support =>
 *   migration FAILS CLOSED. It is not server-authoritative revocation.
 *
 * No PIN, ciphertext, Recovery Key or PackageV2 is ever serialized here.
 */
export type PinDeviceScope=Readonly<{accountId:string;deviceId:string}>

export interface PinSessionLease {
  readonly scope:PinDeviceScope
  readonly name:string
  release():void
}

const PREFIX='pb3:identity:pin-migration:v1:'

function lockName(scope:PinDeviceScope):string{
  if(!scope||!/^[A-Za-z0-9-]{8,64}$/.test(scope.accountId)||
     !/^[A-Za-z0-9-]{8,64}$/.test(scope.deviceId))
    throw new Error('pin.invalid_scope')
  return PREFIX+scope.accountId+':'+scope.deviceId
}

function manager():LockManager|null{
  try{
    if(typeof navigator==='undefined'||!navigator.locks||
      typeof navigator.locks.request!=='function')return null
    return navigator.locks
  }catch{return null}
}

/**
 * Acquire BEFORE exposing a decrypted account package to activeSession.
 * A same-origin future migration cannot acquire its exclusive lock until
 * this lease is explicitly released or its browser context is destroyed.
 * Existing non-PIN accounts can still boot on browsers without Web Locks,
 * but they MUST NOT be migrated to PIN there.
 */
export async function acquirePinSessionLease(
  scope:PinDeviceScope,
):Promise<PinSessionLease|null>{
  const name=lockName(scope)
  const locks=manager()
  if(!locks)return null
  let opened=false
  let released=false
  let releaseGate!:()=>void
  let resolveReady!:(value:void)=>void
  let rejectReady!:(reason:unknown)=>void
  const ready=new Promise<void>((resolve,reject)=>{
    resolveReady=resolve
    rejectReady=reject
  })
  const gate=new Promise<void>(resolve=>{releaseGate=resolve})
  let running:Promise<unknown>
  try{
    running=locks.request(name,{mode:'shared'},async granted=>{
      if(!granted)throw new Error('pin.shared_lock_unavailable')
      opened=true
      resolveReady()
      await gate
    })
  }catch(error){rejectReady(error);throw error}
  // Once a tab has the lease, release() owns its completion. Never leak a
  // rejected lifetime promise as an unhandled browser error.
  void running.catch(error=>{if(!opened)rejectReady(error)})
  await ready
  return {
    name,scope:Object.freeze({...scope}),
    release(){
      if(released)return
      released=true
      releaseGate()
    },
  }
}

/**
 * No wait/queue: an already-unlocked cooperating tab must explicitly close
 * its Session first. This is **not** an authorization proof or accepted
 * production setup flow. Caller also validates account/package/recovery.
 */
export async function withExclusivePinMigration<T>(
  scope:PinDeviceScope,
  work:()=>Promise<T>,
):Promise<T>{
  const name=lockName(scope)
  const locks=manager()
  if(!locks)throw new Error('pin.web_locks_required')
  return locks.request(name,{mode:'exclusive',ifAvailable:true},async granted=>{
    if(!granted)throw new Error('pin.other_tab_active')
    return work()
  })
}
