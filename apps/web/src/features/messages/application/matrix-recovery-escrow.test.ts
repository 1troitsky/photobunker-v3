import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {b64,createPB2,freshPackage,openRecovery,random,sealRecovery} from '../../identity/infrastructure/crypto'
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
    if(path==='/matrix/v1/recovery/ssss'&&method!=='POST'){
      return(server?{present:true,contract:server.contract,
        signature:corruptReceipt?b64(random(64)):server.signature}
        :{present:false}) as never
    }
    if(path==='/matrix/v1/recovery/ssss'&&method==='POST'){
      const signed=data as Receipt
      posts.push(signed)
      if(server &&(server.contract!==signed.contract
        ||server.signature!==signed.signature))throw Error('api.http_409')
      const unchanged=server!==null
      server=signed
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
  server=null;posts=[];loseAck=false;corruptReceipt=false
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
  it('rejects server tampering, new PB3 AKEK, foreign owner and revision',async()=>{
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
    activeSession.value={...session,pkg:{...session.pkg,revision:2}}
    await expect(recoverMatrixSecretStorageKey())
      .rejects.toThrow('matrix.recovery_invalid_contract')
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
