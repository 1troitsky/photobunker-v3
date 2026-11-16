import 'fake-indexeddb/auto'
import {afterEach,describe,it,expect} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,newSigning} from '../../identity/infrastructure/crypto'
import {
  enqueueEncryptedMedia,listLocalMedia,readLocalMedia,readLocalMediaMetadata,
  classifyMediaSyncFailure,
} from './media-outbox'

afterEach(()=>{activeSession.value=null})
async function identity(){
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  const signer=await newSigning(false)
  activeSession.value={
    accountId,deviceId:crypto.randomUUID(),pkg,online:false,
    device:{deviceKey:signer.privateKey},
  } as Session
  return accountId
}
describe('P1-10 offline media outbox security',()=>{
  it('continues real local encryption through an equivalent Session clone',async()=>{
    await identity()
    const before={...activeSession.value!,online:true}
    activeSession.value=before
    const bytes=new Uint8Array(8192).fill(47)
    const task=enqueueEncryptedMedia(new File([bytes],'SESSION-CONTINUITY.wav',{type:'audio/wav'}))
    // An actual online/offline update replaces only the Session wrapper.
    activeSession.value={...before,online:false}
    const id=await task
    const rows=await listLocalMedia()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('queued')
    expect(JSON.stringify(rows[0])).not.toContain('SESSION-CONTINUITY')
    expect(new Uint8Array(await (await readLocalMedia(id)).blob.arrayBuffer())).toEqual(bytes)
  })
  it.each(['account','device id','device key','key package','logout'] as const)(
    'rejects in-flight encryption after a real %s boundary',async boundary=>{
      await identity()
      const before=activeSession.value!
      const replacement=await newSigning(false)
      const task=enqueueEncryptedMedia(new File([new Uint8Array(8192)],'BOUNDARY.wav',{type:'audio/wav'}))
      activeSession.value=boundary==='logout'?null:{...before,
        ...(boundary==='account'?{accountId:crypto.randomUUID()}:{}),
        ...(boundary==='device id'?{deviceId:crypto.randomUUID()}:{}),
        ...(boundary==='device key'?{device:{...before.device,deviceKey:replacement.privateKey}}:{}),
        ...(boundary==='key package'?{pkg:{...before.pkg,revision:before.pkg.revision+1}}:{}),
      }
      await expect(task).rejects.toThrow('identity.account_changed')
      activeSession.value=before
      expect(await listLocalMedia()).toHaveLength(0)
    },
  )
  it('aborts the IndexedDB transaction if identity is lost after ciphertext put',async()=>{
    await identity()
    const before=activeSession.value!
    let checks=0
    await expect(enqueueEncryptedMedia(new File([new Uint8Array(8192)],'ATOMIC.wav',{type:'audio/wav'}),undefined,{},()=>{
      if(++checks===4)activeSession.value=null
    })).rejects.toThrow('identity.account_changed')
    activeSession.value=before
    expect(await listLocalMedia()).toHaveLength(0)
  })
  it('durably persists ONLY ciphertext for selected audio, while offline; decrypts by account key',async()=>{
    const accountId=await identity()
    const bytes=new Uint8Array(2048).fill(112)
    const file=new File([bytes],'PRIVATE-FIRST-VOICE-RECORDING.wav',
      {type:'audio/wav'})
    const id=await enqueueEncryptedMedia(file)
    const rows=await listLocalMedia()
    expect(rows).toHaveLength(1)
    const row=rows[0]!
    expect(row.mediaId).toBe(id)
    expect(row.accountId).toBe(accountId)
    expect(row.state).toBe('queued')
    expect(row.chunks).toHaveLength(2)
    expect(row.signature.length).toBeGreaterThan(50)
    expect(JSON.stringify(row)).not.toContain('PRIVATE-FIRST-VOICE')
    expect(JSON.stringify(row.contract)).not.toContain('audio/wav')
    for(const part of row.chunks){
      const raw=new TextDecoder().decode(await part.blob.arrayBuffer())
      expect(raw).not.toContain('PRIVATE-FIRST-VOICE')
    }
    const read=await readLocalMedia(id)
    const only=await readLocalMediaMetadata(id)
    expect(only.fileName).toBe(file.name)
    expect(only.mime).toBe('audio/wav')
    expect(read.metadata.fileName).toBe(file.name)
    expect(read.blob.type).toBe('audio/wav')
    expect(new Uint8Array(await read.blob.arrayBuffer())).toEqual(bytes)
  })
  it('cannot load or decrypt another account local media',async()=>{
    await identity()
    const id=await enqueueEncryptedMedia(new File([
      new Uint8Array(200).fill(9)],'hidden.jpg',{type:'image/jpeg'}))
    await identity()
    expect(await listLocalMedia()).toHaveLength(0)
    await expect(readLocalMedia(id)).rejects.toThrow('media.not_available')
    await expect(readLocalMediaMetadata(id))
      .rejects.toThrow('media.not_available')
  })
})


describe('Issue #260 atomic consent cancellation',()=>{
  it.each([2,3,4])('rejects at guard %i after real encryption, with no durable row',async cancelAt=>{
    await identity()
    let checks=0
    const assertCurrent=()=>{
      if(++checks===cancelAt)throw Error('camera.gps_consent_changed')
    }
    await expect(enqueueEncryptedMedia(new File([new Uint8Array(1024)],'private.jpg',{type:'image/jpeg'}),undefined,{},assertCurrent))
      .rejects.toThrow('camera.gps_consent_changed')
    expect(await listLocalMedia()).toHaveLength(0)
    expect(checks).toBe(cancelAt)
  })
})

describe('Issue #200 — resumable encrypted outbox error semantics',()=>{
  it('keeps all ciphertext retryable during a live S3 upload lease or transport failure',()=>{
    expect(classifyMediaSyncFailure(Error('api.http_503')))
      .toEqual({state:'retry',lastError:'api.http_503'})
    expect(classifyMediaSyncFailure(Error('api.http_502')))
      .toEqual({state:'retry',lastError:'api.http_502'})
    expect(classifyMediaSyncFailure(Error('api.http_429')))
      .toEqual({state:'retry',lastError:'api.http_429'})
    expect(classifyMediaSyncFailure(Error('media.network_lost')))
      .toEqual({state:'retry',lastError:'media.retry_required'})
  })
  it('never converts a permanent revoked/expired/signed-contract rejection into success',()=>{
    for(const status of [403,409,410,413,422])
      expect(classifyMediaSyncFailure(Error('api.http_'+status)))
        .toEqual({state:'conflict',lastError:'api.http_'+status})
  })
})
