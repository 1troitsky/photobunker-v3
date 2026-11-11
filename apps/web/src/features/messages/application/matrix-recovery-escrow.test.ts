import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,createPB2,digest,hex,freshPackage,openRecovery,random,sealRecovery} from '../../identity/infrastructure/crypto'
import {jsonApi} from '../../identity/infrastructure/api'
import {getBoundMatrixCredentials} from './matrix-binding'
import {
  escrowMatrixSecretStorageKey,retryMatrixRecoveryEscrow,
  recoverMatrixSecretStorageKey,matrixRecoveryPending,
} from './matrix-recovery-escrow'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('./matrix-binding',()=>({getBoundMatrixCredentials:vi.fn()}))

const api=vi.mocked(jsonApi)
const bound=vi.mocked(getBoundMatrixCredentials)
const home='https://matrix.example.test'
const mxid='@alice:matrix.example.test'
type Receipt={contract:string;signature:string}
let session:Session
let server:Receipt|null=null
let historical:Receipt|null=null
let corruptPrevious=false
let posts:Receipt[]=[]
let loseAck=false
let corruptReceipt=false

async function create(id:string=crypto.randomUUID()):Promise<Session>{
  const {pkg}=await freshPackage(id)
  return {accountId:id,deviceId:crypto.randomUUID(),pkg,online:true} as Session
}
async function raw(){
  const d=new Dexie('pb3-matrix-ssss-recovery-pending-v1')
  d.version(1).stores({pending:'&scope'})
  const rows=await d.table('pending').toArray()
  d.close()
  return rows
}
function configure():void{
  api.mockImplementation(async(path,method,data)=>{
    if(path==='/matrix/v1/me')return {
      configured:true,bound:false,homeserverUrl:home,matrixUserId:mxid,
      deviceBinding:null,
    } as never
    if(path==='/matrix/v1/recovery/ssss'&&method!=='POST'){
      if(server &&JSON.parse(server.contract).accountRevision
        !==activeSession.value!.pkg.revision)throw Error('api.http_409')
      return(server?{present:true,contract:server.contract,
        signature:corruptReceipt?b64(random(64)):server.signature}
        :{present:false}) as never
    }
    if(path==='/matrix/v1/recovery/ssss/previous'){
      if(!server||JSON.parse(server.contract).accountRevision
        >=activeSession.value!.pkg.revision)throw Error('api.http_409')
      return {present:true,contract:server.contract,
        signature:corruptPrevious?b64(random(64)):server.signature} as never
    }
    if(path==='/matrix/v1/recovery/ssss'&&method==='POST'){
      const signed=data as Receipt
      posts.push(signed)
      const c=JSON.parse(signed.contract) as {
        version:number;accountRevision:number;previousContractHash?:string
      }
      if(c.accountRevision!==activeSession.value!.pkg.revision)
        throw Error('api.http_422')
      let unchanged=false
      if(server){
        const current=JSON.parse(server.contract) as {accountRevision:number}
        if(current.accountRevision===c.accountRevision){
          if(server.contract!==signed.contract
            ||server.signature!==signed.signature)throw Error('api.http_409')
          unchanged=true
        }else if(current.accountRevision<c.accountRevision
          &&c.version===2
          &&c.previousContractHash===hex(await digest(
            new TextEncoder().encode(server.contract)))){
          historical=server
          server=signed
        }else throw Error('api.http_409')
      }else server=signed
      if(loseAck){loseAck=false;throw Error('network.ack_lost')}
      return {stored:true,unchanged} as never
    }
    throw Error('unexpected API '+path)
  })
  bound.mockImplementation(async()=>({
    contract:{
      version:1,accountId:activeSession.value!.accountId,
      pb3DeviceId:activeSession.value!.deviceId,
      operationId:crypto.randomUUID(),
      homeserverUrl:home,matrixUserId:mxid,matrixDeviceId:'MATRIXDEVICE1',
    },
    accessToken:'test-matrix-token-not-sent-to-escrow',
  }))
}
beforeEach(async()=>{
  const d=new Dexie('pb3-matrix-ssss-recovery-pending-v1')
  d.version(1).stores({pending:'&scope'})
  await d.table('pending').clear()
  d.close()
  session=await create()
  activeSession.value=session
  server=null;historical=null;posts=[];loseAck=false
  corruptReceipt=false;corruptPrevious=false
  api.mockReset();bound.mockReset();configure()
})
afterEach(()=>{activeSession.value=null})

describe('P2-02D1: PB3 Recovery Key sealed Matrix SSSS escrow',()=>{
  it('stores only AES-GCM ciphertext server-side and unlocks on a NEW PB3 device',async()=>{
    const key=random(32)
    await escrowMatrixSecretStorageKey(key)
    expect(server).not.toBeNull()
    expect(posts).toHaveLength(1)
    expect(JSON.stringify(server)).not.toContain(b64(key))
    expect(JSON.stringify(server)).not.toContain('accessToken')
    expect(JSON.stringify(server)).not.toContain(session.pkg.akek)
    expect(await matrixRecoveryPending()).toBe(false)
    // Exercise actual PB3 Recovery Key crypto, not just reusing a Session
    // reference. The new PB3 device receives only the recovered package.
    const kit=await createPB2()
    const recoveryEnvelope=await sealRecovery(session.pkg,kit)
    const recoveredPackage=await openRecovery(
      recoveryEnvelope,kit,session.accountId)
    expect(recoveredPackage.akek).toBe(session.pkg.akek)
    expect(recoveredPackage.accountSpki).toBe(session.pkg.accountSpki)
    const restored={...session,pkg:recoveredPackage,deviceId:crypto.randomUUID()}
    activeSession.value=restored
    // There is no Matrix token or Matrix-device binding on this new PB3
    // device. Only the previously confirmed PB3 account binding exists.
    bound.mockResolvedValue(null)
    const recovered=await recoverMatrixSecretStorageKey()
    expect(Array.from(recovered??[])).toEqual(Array.from(key))
    recovered?.fill(0)
  })
  it('persists signed proof locally before POST, exact replay after lost ACK',async()=>{
    loseAck=true
    const key=random(32)
    await expect(escrowMatrixSecretStorageKey(key))
      .rejects.toThrow('network.ack_lost')
    expect(await matrixRecoveryPending()).toBe(true)
    const rows=await raw()
    expect(rows).toHaveLength(1)
    const json=JSON.stringify(rows)
    expect(json).not.toContain(session.accountId)
    expect(json).not.toContain(mxid)
    expect(json).not.toContain(b64(key))
    expect(json).not.toContain(session.pkg.akek)
    expect(json).not.toContain('signature')
    await retryMatrixRecoveryEscrow()
    expect(posts).toHaveLength(2)
    expect(posts[1]).toEqual(posts[0])
    expect(await matrixRecoveryPending()).toBe(false)
    const restored=await recoverMatrixSecretStorageKey()
    expect(Array.from(restored??[])).toEqual(Array.from(key))
    restored?.fill(0)
  })
  it('never confirms a write without account-signed exact server readback',async()=>{
    corruptReceipt=true
    await expect(escrowMatrixSecretStorageKey(random(32)))
      .rejects.toThrow('matrix.recovery_ack_unverified')
    expect(await matrixRecoveryPending()).toBe(true)
    corruptReceipt=false
    await retryMatrixRecoveryEscrow()
    expect(await matrixRecoveryPending()).toBe(false)
  })
  it('rejects server tampering, new PB3 AKEK and foreign owner while allowing valid rewrap',async()=>{
    const key=random(32)
    await escrowMatrixSecretStorageKey(key)
    corruptReceipt=true
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_untrusted_receipt')
    corruptReceipt=false
    const wrong=await create(session.accountId)
    activeSession.value=wrong
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_untrusted_receipt')
    activeSession.value=session
    const outsider=await create()
    activeSession.value=outsider
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_invalid_contract')
    // Revisions with the SAME PB3 AKEK/root are now safely rewrapped:
    // they are no longer a permanent 409 recovery dead end.
    activeSession.value={...session,pkg:{...session.pkg,revision:2}}
    const migrated=await recoverMatrixSecretStorageKey()
    expect(Array.from(migrated??[])).toEqual(Array.from(key))
    migrated?.fill(0)
    expect(JSON.parse(server!.contract).accountRevision).toBe(2)
  })
  it('rewraps an old signed 4S seed after PB3 revision change, keeps rev1 forever',async()=>{
    const seed=random(32)
    await escrowMatrixSecretStorageKey(seed)
    const rev1=server!
    const rev2={...session,pkg:{...session.pkg,revision:2}}
    activeSession.value=rev2
    // New PB3 device has no local Matrix access token or Matrix binding.
    bound.mockResolvedValue(null)
    const recovered=await recoverMatrixSecretStorageKey()
    expect(Array.from(recovered??[])).toEqual(Array.from(seed))
    recovered?.fill(0)
    expect(historical).toEqual(rev1)
    expect(server!.contract).not.toBe(rev1.contract)
    expect(JSON.parse(server!.contract)).toMatchObject({
      version:2,accountRevision:2,
      previousContractHash:hex(await digest(
        new TextEncoder().encode(rev1.contract))),
    })
    expect(await matrixRecoveryPending()).toBe(false)
    expect(JSON.stringify(server)).not.toContain(b64(seed))
    expect(JSON.stringify(server)).not.toContain(session.pkg.akek)
    const rev3={...rev2,pkg:{...rev2.pkg,revision:3},
      deviceId:crypto.randomUUID()}
    activeSession.value=rev3
    const second=await recoverMatrixSecretStorageKey()
    expect(Array.from(second??[])).toEqual(Array.from(seed))
    second?.fill(0)
    expect(JSON.parse(server!.contract).accountRevision).toBe(3)
    expect(JSON.stringify(server)).not.toContain(b64(seed))
  })

  it('keeps sealed pending rev2 across lost ACK and resumes without Matrix device token',async()=>{
    const seed=random(32)
    await escrowMatrixSecretStorageKey(seed)
    const rev1=server!
    activeSession.value={...session,pkg:{...session.pkg,revision:2},
      deviceId:crypto.randomUUID()}
    bound.mockResolvedValue(null)
    loseAck=true
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('network.ack_lost')
    expect(await matrixRecoveryPending()).toBe(true)
    const rows=await raw()
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(b64(seed))
    expect(JSON.stringify(rows)).not.toContain(session.accountId)
    await retryMatrixRecoveryEscrow()
    expect(await matrixRecoveryPending()).toBe(false)
    const rewrapPosts=posts.slice(1)
    expect(rewrapPosts).toHaveLength(2)
    expect(rewrapPosts[1]).toEqual(rewrapPosts[0])
    expect(historical).toEqual(rev1)
    const key=await recoverMatrixSecretStorageKey()
    expect(Array.from(key??[])).toEqual(Array.from(seed))
    key?.fill(0)
  })

  it('does not overwrite old escrow when AKEK changes or prior root proof is forged',async()=>{
    const seed=random(32)
    await escrowMatrixSecretStorageKey(seed)
    const rev1=server!
    activeSession.value={...session,pkg:{...session.pkg,revision:2,
      akek:b64(random(32))}}
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_unwrap_failed')
    expect(server).toEqual(rev1)
    expect(posts).toHaveLength(1)
    expect(await matrixRecoveryPending()).toBe(false)
    activeSession.value={...session,pkg:{...session.pkg,revision:2}}
    corruptPrevious=true
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_untrusted_receipt')
    expect(server).toEqual(rev1)
    expect(posts).toHaveLength(1)
  })

  it('refuses invalid raw key, missing Matrix binding and offline escrow',async()=>{
    await expect(escrowMatrixSecretStorageKey(random(31)))
      .rejects.toThrow('matrix.recovery_key_invalid')
    activeSession.value={...session,online:false}
    await expect(escrowMatrixSecretStorageKey(random(32)))
      .rejects.toThrow('matrix.recovery_requires_online')
    activeSession.value=session
    bound.mockResolvedValue(null)
    await expect(escrowMatrixSecretStorageKey(random(32)))
      .rejects.toThrow('matrix.recovery_binding_required')
    expect(posts).toHaveLength(0)
  })
})
