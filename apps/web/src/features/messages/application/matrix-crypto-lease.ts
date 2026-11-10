/** One exclusive Web Lock per PB3+Matrix crypto store.
 * RustCrypto is NOT safe for concurrent use of the same IndexedDB.
 * No fallback to localStorage flags, BroadcastChannel elections or timeouts.
 */
export interface MatrixCryptoLease {release():Promise<void>}

export async function acquireMatrixCryptoLease(scope:string):Promise<MatrixCryptoLease>{
  if(!/^pb3-matrix-[a-f0-9]{64}$/.test(scope))throw Error('matrix.invalid_lock_scope')
  if(typeof navigator==='undefined'||!navigator.locks?.request)
    throw Error('matrix.web_locks_unavailable')
  let releaseHold:(()=>void)|null=null
  let readyResolve!:()=>void
  let readyReject!:(reason:Error)=>void
  let resolved=false
  const ready=new Promise<void>((resolve,reject)=>{
    readyResolve=resolve;readyReject=reject
  })
  const lockTask=navigator.locks.request(scope,{mode:'exclusive',ifAvailable:true},
    async lock=>{
      if(!lock){
        resolved=true
        readyReject(Error('matrix.crypto_store_in_use'))
        return
      }
      await new Promise<void>(resolve=>{
        releaseHold=resolve
        resolved=true
        readyResolve()
      })
    })
  void lockTask.catch(()=>{
    if(!resolved)readyReject(Error('matrix.crypto_lock_failed'))
  })
  await ready
  let released=false
  return {release:async()=>{
    if(released)return
    released=true
    releaseHold?.()
    await lockTask
  }}
}
