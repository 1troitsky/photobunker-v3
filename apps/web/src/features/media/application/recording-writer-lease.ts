/**
 * Chromium/Safari Web Locks are origin-wide across same-origin tabs. This is
 * a LIVE writer fence, not a heartbeat or timestamp: a crashed document drops
 * its held lock while a slow but living writer never becomes "stale".
 * If Web Locks is unsupported recording may still work, but legacy journals
 * cannot be adopted/recovered safely.
 */
export interface CameraWriterLease {
  readonly accountId: string
  isHeld(): boolean
  release(): void
}
const PREFIX='pb3.camera.writer.v1.'
function lockName(accountId:string):string{
  if(typeof accountId!=='string'||accountId.length<1||accountId.length>128
    ||!/^[a-zA-Z0-9._:-]+$/.test(accountId))
    throw Error('camera.recording_identity_invalid')
  return PREFIX+accountId
}
export function supportsCameraWriterLease():boolean{
  return typeof navigator!=='undefined'
    &&typeof navigator.locks?.request==='function'
}
/**
 * Resolve only AFTER the browser actually grants the exclusive lock. The
 * callback remains pending until release() and across all async media writes.
 * "ifAvailable" ensures a second tab never silently waits to replace a live
 * writer or to mutate an in-progress journal.
 *
 * null means unsupported platform: capture can proceed, but cannot mark its
 * draft as safely adoptable. A BUSY lock is never treated as unsupported.
 */
export async function acquireCameraWriterLease(
  accountId:string,
):Promise<CameraWriterLease|null>{
  const name=lockName(accountId)
  if(!supportsCameraWriterLease())return null
  return new Promise<CameraWriterLease>((resolve,reject)=>{
    let settled=false
    const fail=(reason:unknown)=>{
      if(settled)return
      settled=true
      reject(reason)
    }
    void navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},
      async(lock)=>{
        if(!lock){
          fail(Error('camera.recording_writer_busy'))
          return
        }
        let held=true
        let releaseWait!:()=>void
        const waiting=new Promise<void>(done=>{releaseWait=done})
        const lease:CameraWriterLease={
          accountId,
          isHeld:()=>held,
          release:()=>{
            if(!held)return
            held=false
            releaseWait()
          },
        }
        settled=true
        resolve(lease)
        await waiting
      }).catch(fail)
  })
}
/**
 * This helper refuses unsupported Web Locks. Its caller may safely do a
 * same-account atomic "writing"→"interrupted" classification only after
 * it has acquired exclusive live-writer ownership.
 */
export async function withIdleCameraWriterLease<T>(
  accountId:string,task:()=>Promise<T>,
):Promise<T>{
  if(!supportsCameraWriterLease())
    throw Error('camera.recording_recovery_unsupported')
  const lease=await acquireCameraWriterLease(accountId)
  if(!lease)throw Error('camera.recording_recovery_unsupported')
  try{
    if(!lease.isHeld())throw Error('camera.recording_writer_busy')
    return await task()
  }finally{lease.release()}
}
