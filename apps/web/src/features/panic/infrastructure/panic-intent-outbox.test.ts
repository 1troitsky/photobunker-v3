import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {PanicIntentJournal} from './panic-intent-outbox'
import {createSignedPanicIntent} from '../domain/panic-intent'
import type {PanicIntentScope,SignedPanicIntent} from '../domain/panic-intent'
import {exportSpki,newSigning} from '../../identity/infrastructure/crypto'

const uuid=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
const SCOPE:PanicIntentScope={accountId:uuid(1),deviceId:uuid(2),keyRevision:4}
const NOW=1_800_000_000_000
let name:string
let journals:PanicIntentJournal[]

beforeEach(()=>{
  name='pb3-panic-test-'+crypto.randomUUID()
  journals=[]
})
afterEach(async()=>{
  for(const j of journals)j.close()
  await Dexie.delete(name)
})
function journal(){
  const j=new PanicIntentJournal(name)
  journals.push(j)
  return j
}
async function fixture(scope:PanicIntentScope=SCOPE){
  const keys=await newSigning(true)
  const spki=await exportSpki(keys.publicKey)
  const intent=await createSignedPanicIntent(scope,keys.privateKey,NOW)
  return {keys,spki,intent}
}
async function mutateDb(
  cb:(table:Dexie.Table)=>Promise<unknown>,
):Promise<void>{
  // A separate tab/IDB process can change its own untrusted local storage.
  // Read must check the signed bytes after every reload and reject corruption.
  const raw=new Dexie(name)
  raw.version(1).stores({entries:'&slot,&operationId,accountId,deviceId'})
  try{await cb(raw.table('entries'))}
  finally{raw.close()}
}

describe('P3 #221 offline PREPARED Panic journal — no remote calls or local deletion',()=>{
  it('only returns prepared AFTER durable write and survives new instance/reload',async()=>{
    const {intent,spki}=await fixture()
    const first=journal()
    expect(await first.read(SCOPE,spki,NOW)).toBe(null)
    expect(await first.prepare(intent,SCOPE,spki,NOW)).toEqual(intent)
    first.close()
    const next=journal()
    expect(await next.read(SCOPE,spki,NOW+180*86400000)).toEqual(intent)
    expect(await next.prepare(intent,SCOPE,spki,NOW+180*86400000))
      .toEqual(intent)
    // Durable metadata is still only a prepared NOT ACKed or deleted command.
    expect((await next.read(SCOPE,spki,NOW))!.contract).toContain(
      'preserve-existing-verified')
  })

  it('rejects creating a SECOND different intent for the same account/device',async()=>{
    const {keys,spki,intent}=await fixture()
    const second=await createSignedPanicIntent(SCOPE,keys.privateKey,NOW+1)
    const j=journal()
    await j.prepare(intent,SCOPE,spki,NOW)
    await expect(j.prepare(second,SCOPE,spki,NOW+1))
      .rejects.toThrow('panic.prepared_conflict')
    expect(await j.read(SCOPE,spki,NOW+1)).toEqual(intent)
  })

  it('serializes TWO tabs racing distinct commands: exactly one persists',async()=>{
    const {keys,spki,intent}=await fixture()
    const other=await createSignedPanicIntent(SCOPE,keys.privateKey,NOW)
    const a=journal(),b=journal()
    const results=await Promise.allSettled([
      a.prepare(intent,SCOPE,spki,NOW),
      b.prepare(other,SCOPE,spki,NOW),
    ])
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1)
    const winner=results.find(x=>x.status==='fulfilled') as
      PromiseFulfilledResult<SignedPanicIntent>
    expect(await a.read(SCOPE,spki,NOW)).toEqual(winner.value)
    expect(await b.read(SCOPE,spki,NOW)).toEqual(winner.value)
  })

  it('replays exact original bytes across different tabs without re-signing',async()=>{
    const {intent,spki}=await fixture()
    const a=journal(),b=journal()
    const out=await Promise.all([
      a.prepare(intent,SCOPE,spki,NOW),
      b.prepare(intent,SCOPE,spki,NOW),
    ])
    expect(out[0]).toEqual(intent)
    expect(out[1]).toEqual(intent)
    expect(await b.read(SCOPE,spki,NOW+365*86400000)).toEqual(intent)
  })

  it('allows distinct account/device slots without mixing or replacing each other',async()=>{
    const aScope=SCOPE,bScope={...SCOPE,deviceId:uuid(3)}
    const a=await fixture(aScope),b=await fixture(bScope)
    const j=journal()
    await j.prepare(a.intent,aScope,a.spki,NOW)
    await j.prepare(b.intent,bScope,b.spki,NOW)
    expect(await j.read(aScope,a.spki,NOW)).toEqual(a.intent)
    expect(await j.read(bScope,b.spki,NOW)).toEqual(b.intent)
    await expect(j.read(bScope,a.spki,NOW))
      .rejects.toThrow('panic.corrupt_prepared_intent')
  })

  it('refuses stale keyRevision even for same account/device (does not erase older command)',async()=>{
    const {intent,spki}=await fixture()
    const j=journal()
    await j.prepare(intent,SCOPE,spki,NOW)
    const upgraded={...SCOPE,keyRevision:SCOPE.keyRevision+1}
    await expect(j.read(upgraded,spki,NOW))
      .rejects.toThrow('panic.corrupt_prepared_intent')
    expect(await j.read(SCOPE,spki,NOW)).toEqual(intent)
  })

  it('does not persist a command signed by the wrong registered device',async()=>{
    const {intent}=await fixture()
    const other=await fixture()
    const j=journal()
    await expect(j.prepare(intent,SCOPE,other.spki,NOW))
      .rejects.toThrow('panic.invalid_intent')
    expect(await j.read(SCOPE,other.spki,NOW)).toBe(null)
  })

  it('rejects corrupted persistent signature on read without silently dropping the request',async()=>{
    const {intent,spki}=await fixture()
    const j=journal()
    await j.prepare(intent,SCOPE,spki,NOW)
    await mutateDb(async t=>{
      await t.update(SCOPE.accountId+'/'+SCOPE.deviceId,{signature:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'})
    })
    await expect(j.read(SCOPE,spki,NOW))
      .rejects.toThrow('panic.corrupt_prepared_intent')
    await expect(j.prepare(intent,SCOPE,spki,NOW))
      .rejects.toThrow('panic.prepared_conflict')
  })

  it('rejects raw IndexedDB shape tampering and Vault expansion before reporting prepared',async()=>{
    const {intent,spki}=await fixture()
    const j=journal()
    await j.prepare(intent,SCOPE,spki,NOW)
    await mutateDb(async t=>{
      await t.update(SCOPE.accountId+'/'+SCOPE.deviceId,{phase:'cloud_deleted'})
    })
    await expect(j.read(SCOPE,spki,NOW))
      .rejects.toThrow('panic.corrupt_prepared_intent')
    await expect(j.prepare(intent,SCOPE,spki,NOW))
      .rejects.toThrow('panic.corrupt_prepared_intent')
  })

  it('does not accept future-dated fake OFFLINE requests',async()=>{
    const {keys,spki}=await fixture()
    const j=journal()
    const future=await createSignedPanicIntent(SCOPE,keys.privateKey,NOW+120001)
    await expect(j.prepare(future,SCOPE,spki,NOW))
      .rejects.toThrow('panic.invalid_intent')
    expect(await j.read(SCOPE,spki,NOW)).toBe(null)
  })

  it('does not claim success for invalid scope or forged request in store',async()=>{
    const {intent,spki}=await fixture()
    const j=journal()
    await expect(j.prepare(intent,{...SCOPE,accountId:'bad'},spki,NOW))
      .rejects.toThrow('panic.invalid_scope')
    expect(await j.read(SCOPE,spki,NOW)).toBe(null)
  })
})
