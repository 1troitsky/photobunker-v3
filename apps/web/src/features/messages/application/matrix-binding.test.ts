import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {freshPackage,newSigning,exportSpki} from '../../identity/infrastructure/crypto'
import {beginMatrixBinding,retryMatrixBinding,stagedMatrixBinding,
  getBoundMatrixCredentials} from './matrix-binding'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
const mock=vi.mocked(jsonApi)
const home='https://matrix.example.test'
const credential='test_matrix_dev_credential_abcdef0123456789'
let s:Session
let receipt:{contract:string;accountSignature:string;deviceSignature:string}|null
let attempts:unknown[]
let interrupted:boolean
beforeEach(async()=>{
  const db=new Dexie('pb3-sealed-matrix-credentials-v1')
  db.version(1).stores({credentials:'&scope'})
  await db.table('credentials').clear()
  db.close()
  const accountId=crypto.randomUUID(),{pkg}=await freshPackage(accountId)
  const kp=await newSigning(false)
  s={accountId,deviceId:crypto.randomUUID(),pkg,online:true,
    device:{deviceKey:kp.privateKey,deviceSpki:await exportSpki(kp.publicKey)}
  } as unknown as Session
  activeSession.value=s
  receipt=null;attempts=[];interrupted=false
  mock.mockReset()
  mock.mockImplementation(async(path,method,body)=>{
    if(path==='/matrix/v1/me')
      return {configured:true,bound:receipt!==null,
        homeserverUrl:home,deviceBinding:receipt} as never
    if(path==='/matrix/v1/bindings'&&method==='POST'){
      attempts.push(body)
      const b=body as {contract:string;accountSignature:string;deviceSignature:string}
      receipt={contract:b.contract,accountSignature:b.accountSignature,
        deviceSignature:b.deviceSignature}
      if(interrupted){interrupted=false;throw Error('test.ack_lost')}
      return {bound:true,unchanged:attempts.length>1} as never
    }
    throw Error('unexpected API')
  })
})
afterEach(()=>{activeSession.value=null})
const binding={
  matrixUserId:'@alice:matrix.example.test',
  matrixDeviceId:'DEVICE_A',
  accessToken:credential,
}
describe('Matrix account and device binding: encrypted local staging',()=>{
  it('saves only ciphertext and confirmed identity',async()=>{
    await beginMatrixBinding(binding)
    expect(await stagedMatrixBinding()).toBe('bound')
    expect((await getBoundMatrixCredentials())?.accessToken).toBe(credential)
    const db=new Dexie('pb3-sealed-matrix-credentials-v1')
    db.version(1).stores({credentials:'&scope'})
    const rows=await db.table('credentials').toArray()
    db.close()
    expect(rows).toHaveLength(1)
    const raw=JSON.stringify(rows)
    expect(raw).not.toContain(credential)
    expect(raw).not.toContain(s.accountId)
    expect(raw).not.toContain('DEVICE_A')
    expect(rows[0]).toHaveProperty('iv')
    expect(rows[0]).toHaveProperty('ciphertext')
  })
  it('replays exact same signed contract after lost ACK',async()=>{
    interrupted=true
    await expect(beginMatrixBinding(binding)).rejects.toThrow('test.ack_lost')
    expect(await stagedMatrixBinding()).toBe('pending')
    expect(await getBoundMatrixCredentials()).toBeNull()
    await retryMatrixBinding()
    expect(await stagedMatrixBinding()).toBe('bound')
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
  })
  it('fails closed for offline or different PB3 account',async()=>{
    activeSession.value={...s,online:false} as Session
    await expect(beginMatrixBinding(binding)).rejects.toThrow('matrix.pb3_session_offline')
    activeSession.value=s
    await beginMatrixBinding(binding)
    const accountId=crypto.randomUUID(),{pkg}=await freshPackage(accountId)
    activeSession.value={...s,accountId,pkg} as Session
    expect(await stagedMatrixBinding()).toBe('none')
    expect(await getBoundMatrixCredentials()).toBeNull()
  })
})
