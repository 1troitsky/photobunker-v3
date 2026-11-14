// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  acquireCameraWriterLease,supportsCameraWriterLease,withIdleCameraWriterLease,
} from './recording-writer-lease'

const oldDescriptor=Object.getOwnPropertyDescriptor(navigator,'locks')
const held=new Set<string>()
const seen:string[]=[]
beforeEach(()=>{
  held.clear();seen.length=0
  Object.defineProperty(navigator,'locks',{configurable:true,value:{
    request:async(name:string,options:{mode:string;ifAvailable:boolean},
      task:(lock:{name:string;mode:string}|null)=>Promise<void>)=>{
      expect(options).toEqual({mode:'exclusive',ifAvailable:true})
      seen.push(name)
      if(held.has(name))return task(null)
      held.add(name)
      try{return await task({name,mode:'exclusive'})}
      finally{held.delete(name)}
    },
  }})
})
afterEach(()=>{
  if(oldDescriptor)Object.defineProperty(navigator,'locks',oldDescriptor)
  else delete (navigator as {locks?:unknown}).locks
  vi.restoreAllMocks()
})
describe('P2 #206 live origin-wide writer lease, never heartbeat takeover',()=>{
  it('holds lock across async work and refuses second same-account writer without waiting',async()=>{
    const first=await acquireCameraWriterLease('account-a')
    expect(first?.isHeld()).toBe(true)
    await expect(acquireCameraWriterLease('account-a'))
      .rejects.toThrow('camera.recording_writer_busy')
    const second=await acquireCameraWriterLease('account-b')
    expect(second?.isHeld()).toBe(true)
    expect(seen).toEqual([
      'pb3.camera.writer.v1.account-a',
      'pb3.camera.writer.v1.account-a',
      'pb3.camera.writer.v1.account-b',
    ])
    first!.release()
    first!.release()
    expect(first?.isHeld()).toBe(false)
    second!.release()
    await vi.waitFor(()=>expect(held.size).toBe(0))
    const replacement=await acquireCameraWriterLease('account-a')
    expect(replacement?.isHeld()).toBe(true)
    replacement?.release()
  })

  it('rejects unsafe recovery while a live writer is active and permits it afterward',async()=>{
    const live=await acquireCameraWriterLease('account-a')
    const action=vi.fn(async()=> 'recovered')
    await expect(withIdleCameraWriterLease('account-a',action))
      .rejects.toThrow('camera.recording_writer_busy')
    expect(action).not.toHaveBeenCalled()
    live?.release()
    await vi.waitFor(()=>expect(held.size).toBe(0))
    expect(await withIdleCameraWriterLease('account-a',action)).toBe('recovered')
    expect(action).toHaveBeenCalledTimes(1)
    await vi.waitFor(()=>expect(held.size).toBe(0))
  })

  it('releases lock after negative task, never retaining a phantom writer',async()=>{
    await expect(withIdleCameraWriterLease('account-a',async()=>{
      throw Error('camera.local_data_corrupt')
    })).rejects.toThrow('camera.local_data_corrupt')
    await vi.waitFor(()=>expect(held.size).toBe(0))
    const after=await acquireCameraWriterLease('account-a')
    expect(after?.isHeld()).toBe(true)
    after!.release()
  })

  it('disables post-crash recovery without native Web Locks instead of guessing by time',async()=>{
    Object.defineProperty(navigator,'locks',{configurable:true,value:undefined})
    expect(supportsCameraWriterLease()).toBe(false)
    expect(await acquireCameraWriterLease('account-a')).toBeNull()
    await expect(withIdleCameraWriterLease('account-a',async()=>true))
      .rejects.toThrow('camera.recording_recovery_unsupported')
  })

  it('rejects malformed scope names instead of colliding lock namespaces',async()=>{
    for(const name of ['', 'account/a', 'account a', 'x'.repeat(129)]){
      await expect(acquireCameraWriterLease(name))
        .rejects.toThrow('camera.recording_identity_invalid')
    }
  })
})
