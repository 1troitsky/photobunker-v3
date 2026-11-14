import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  acquirePinSessionLease,withExclusivePinMigration,
} from './pin-session-lease'
import {TestPinLockManager} from './pin-test-locks'

const alice={
  accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  deviceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}
const bob={
  accountId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  deviceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
}

let locks:TestPinLockManager
beforeEach(()=>{
  locks=new TestPinLockManager()
  vi.stubGlobal('navigator',{locks})
})
afterEach(()=>vi.unstubAllGlobals())
const settled=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}

describe('P3 #220 cooperative browser Web Locks lease barrier (pre-enrolment)',()=>{
  it('rejects exclusive PIN migration while another tab has decrypted shared lease',async()=>{
    const reader=await acquirePinSessionLease(alice)
    expect(reader).not.toBeNull()
    expect(reader?.name).toContain(alice.accountId)
    const callback=vi.fn(async()=>true)
    await expect(withExclusivePinMigration(alice,callback))
      .rejects.toThrow('pin.other_tab_active')
    expect(callback).not.toHaveBeenCalled()
    reader!.release()
    reader!.release() // idempotent
    await settled()
    expect(await withExclusivePinMigration(alice,callback)).toBe(true)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('requires ALL concurrent same-device readers to release, not only one',async()=>{
    const a=await acquirePinSessionLease(alice)
    const b=await acquirePinSessionLease(alice)
    expect(locks.heldNames()).toHaveLength(1)
    a!.release()
    await settled()
    await expect(withExclusivePinMigration(alice,async()=>42))
      .rejects.toThrow('pin.other_tab_active')
    b!.release()
    await settled()
    expect(await withExclusivePinMigration(alice,async()=>42)).toBe(42)
  })

  it('an unrelated account/device cannot block this PIN migration',async()=>{
    const other=await acquirePinSessionLease(bob)
    expect(await withExclusivePinMigration(alice,async()=>true)).toBe(true)
    other!.release()
  })

  it('holds exclusive until KDF and transaction callback completes',async()=>{
    let release!:()=>void
    let notify!:()=>void
    const started=new Promise<void>(resolve=>{notify=resolve})
    const blocked=new Promise<void>(resolve=>{release=resolve})
    const migration=withExclusivePinMigration(alice,async()=>{
      notify()
      await blocked
      return 'committed'
    })
    await started
    let granted=false
    const reader=acquirePinSessionLease(alice).then(x=>{
      granted=true
      return x
    })
    await settled()
    expect(granted).toBe(false)
    await expect(withExclusivePinMigration(alice,async()=>false))
      .rejects.toThrow('pin.other_tab_active')
    release()
    expect(await migration).toBe('committed')
    const second=await reader
    expect(granted).toBe(true)
    second?.release()
  })

  it('unavailable Web Locks permits old account but ALWAYS blocks new PIN migration',async()=>{
    vi.stubGlobal('navigator',{})
    expect(await acquirePinSessionLease(alice)).toBeNull()
    const work=vi.fn(async()=>true)
    await expect(withExclusivePinMigration(alice,work))
      .rejects.toThrow('pin.web_locks_required')
    expect(work).not.toHaveBeenCalled()
  })

  it('a failed exclusive callback releases its lock instead of stranding users',async()=>{
    await expect(withExclusivePinMigration(alice,async()=>{
      throw new Error('test.cryptography_failed')
    })).rejects.toThrow('test.cryptography_failed')
    await settled()
    const reader=await acquirePinSessionLease(alice)
    expect(reader).not.toBeNull()
    reader?.release()
  })

  it('rejects malformed/foreign account and device scope before opening a lock',async()=>{
    const callback=vi.fn(async()=>true)
    await expect(withExclusivePinMigration({
      accountId:'short',deviceId:alice.deviceId,
    },callback)).rejects.toThrow('pin.invalid_scope')
    expect(callback).not.toHaveBeenCalled()
    expect(locks.heldNames()).toHaveLength(0)
  })
})
