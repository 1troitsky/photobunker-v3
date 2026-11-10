import {afterEach,describe,expect,it,vi} from 'vitest'
import {
  acquireMatrixCryptoLease,
} from './matrix-crypto-lease'

type Request=(name:string,options:{mode:string;ifAvailable:boolean},
  callback:(lock:{name:string;mode:string}|null)=>Promise<void>)=>Promise<void>
let busy=false
const request:Request=async(name,options,callback)=>{
  expect(options).toEqual({mode:'exclusive',ifAvailable:true})
  if(busy)return callback(null)
  busy=true
  try{await callback({name,mode:'exclusive'})}finally{busy=false}
}
afterEach(()=>{vi.unstubAllGlobals();busy=false})
describe('exclusive Rust Crypto IndexedDB owner',()=>{
  it('holds one lock for the entire crypto lifecycle and denies contenders',async()=>{
    vi.stubGlobal('navigator',{locks:{request}})
    const name='pb3-matrix-'+'a'.repeat(64)
    const first=await acquireMatrixCryptoLease(name)
    await expect(acquireMatrixCryptoLease(name))
      .rejects.toThrow('matrix.crypto_store_in_use')
    await first.release()
    const next=await acquireMatrixCryptoLease(name)
    await next.release()
    await next.release() // idempotent release
    expect(busy).toBe(false)
  })
  it('fails closed instead of falling back to localStorage if Web Locks unavailable',async()=>{
    vi.stubGlobal('navigator',{})
    await expect(acquireMatrixCryptoLease('pb3-matrix-'+'b'.repeat(64)))
      .rejects.toThrow('matrix.web_locks_unavailable')
  })
  it('rejects unscoped and user-controlled lock identifiers',async()=>{
    vi.stubGlobal('navigator',{locks:{request}})
    await expect(acquireMatrixCryptoLease('shared-crypto-store'))
      .rejects.toThrow('matrix.invalid_lock_scope')
  })
})
