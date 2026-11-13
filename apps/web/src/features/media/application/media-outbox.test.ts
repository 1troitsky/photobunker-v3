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
