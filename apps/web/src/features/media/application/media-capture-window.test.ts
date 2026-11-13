import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,newSigning} from '../../identity/infrastructure/crypto'
import {enqueueEncryptedMedia,listLocalMedia} from './media-outbox'
import type {MediaCaptureIntent} from './media-outbox'

afterEach(()=>{activeSession.value=null})

type Kind='photo'|'video'|'audio'
async function identity(){
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  const deviceKey=(await newSigning(false)).privateKey
  activeSession.value={
    accountId,deviceId:crypto.randomUUID(),pkg,online:false,
    device:{deviceKey},
  } as Session
  return accountId
}
function claim(kind:Kind,contributorAccountId:string,durationMs:number):MediaCaptureIntent{
  const finishedAt=Date.now()
  return {
    assignmentId:crypto.randomUUID(),ownerAccountId:crypto.randomUUID(),
    contributorAccountId,policyRevision:kind==='photo'?1:2,
    policyHash:'a'.repeat(64),mediaType:kind,
    startedAt:finishedAt-durationMs,finishedAt,
  }
}
function file(kind:Kind):File{
  const mime=kind==='photo'?'image/jpeg':kind==='video'?'video/webm':'audio/webm'
  return new File([new Uint8Array(2048).fill(53)],'private-capture', {type:mime})
}

describe('P2 #206 real offline encrypted signed-capture per-kind ceiling',()=>{
  it.each([
    ['photo',180_000],
    ['video',300_000],
    ['audio',3_000_000],
  ] as const)('persists signed %s max duration %i milliseconds without leaking plaintext',async(kind,ms)=>{
    const accountId=await identity()
    const id=await enqueueEncryptedMedia(file(kind),claim(kind,accountId,ms))
    const rows=await listLocalMedia()
    expect(rows).toHaveLength(1)
    const row=rows[0]!
    expect(row.mediaId).toBe(id)
    expect(row.mediaType).toBe(kind)
    expect(row.capture?.signature.length).toBeGreaterThan(60)
    const captured=JSON.parse(row.capture!.contract)
    expect(captured.finishedAt-captured.startedAt).toBe(ms)
    expect(captured.mediaId).toBe(id)
    expect(captured.mediaType).toBe(kind)
    expect(captured.policyRevision).toBe(kind==='photo'?1:2)
    for(const part of row.chunks)expect(part.blob.type).toBe('application/octet-stream')
    expect(JSON.stringify(row)).not.toContain('private-capture')
  })
  it.each([
    ['photo',180_001],
    ['video',300_001],
    ['audio',3_000_001],
    ['video',0],
    ['audio',-1],
  ] as const)('rejects invalid signed %s interval %i and never writes a row',async(kind,ms)=>{
    const accountId=await identity()
    await expect(enqueueEncryptedMedia(file(kind),claim(kind,accountId,ms)))
      .rejects.toThrow('media.invalid_capture_intent')
    expect(await listLocalMedia()).toHaveLength(0)
  })
})
