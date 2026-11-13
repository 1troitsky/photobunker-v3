import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {afterEach,describe,expect,it} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  appendEncryptedRecordingSegment,createEncryptedRecordingDraft,
  deleteEncryptedRecordingDraft,interruptEncryptedRecordingDraft,
  listEncryptedRecordingDrafts,readCompletedEncryptedRecording,
  sealEncryptedRecordingDraft,purgeExpiredEncryptedRecordingDrafts,
  readEncryptedRecordingForPrivateReview,eraseAllEncryptedRecordingScratchForPanic,
} from './recording-encrypted-journal'

afterEach(()=>{activeSession.value=null})
async function account(id:string=crypto.randomUUID()):Promise<Session>{
  const {pkg}=await freshPackage(id)
  const session={
    accountId:id,deviceId:crypto.randomUUID(),pkg,online:false,
  } as Session
  activeSession.value=session
  return session
}
function sample(size=200,value=33):Blob{
  return new Blob([new Uint8Array(size).fill(value)],{type:'audio/webm'})
}
async function rawRecording(id:string,accountId:string):Promise<{
  row:Record<string,unknown>;part:Record<string,unknown>
}> {
  const peek=new Dexie('pb3-encrypted-recording-journal-v1')
  peek.version(1).stores({
    recordings:'&key,accountId,[accountId+createdAt]',
    segments:'&key,recordingKey,[recordingKey+index]',
  })
  try{
    const row=await peek.table('recordings').get(accountId+'/'+id)
    const part=await peek.table('segments').get(accountId+'/'+id+'/0')
    return {row,part}
  }finally{peek.close()}
}
describe('P2 #206 account-bound encrypted MediaRecorder scratch (not a MediaFile)',()=>{
  it('encrypts each segment before IndexedDB, then reassembles exact bytes only after explicit seal',async()=>{
    const s=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(id,0,sample(201,11))
    await appendEncryptedRecordingSegment(id,1,sample(202,55))
    const {row,part}=await rawRecording(id,s.accountId)
    expect(row.state).toBe('writing')
    expect(row.wrapped).toBeDefined()
    expect(row).not.toHaveProperty('gps')
    expect(row).not.toHaveProperty('fileName')
    expect(part.ciphertext).toBeInstanceOf(Blob)
    expect((part.ciphertext as Blob).type).toBe('application/octet-stream')
    expect((part.ciphertext as Blob).size).toBe(217)
    expect(new Uint8Array(await (part.ciphertext as Blob).arrayBuffer()))
      .not.toEqual(new Uint8Array(201).fill(11))
    await expect(readCompletedEncryptedRecording(id))
      .rejects.toThrow('camera.recording_not_finalized')
    await sealEncryptedRecordingDraft(id,5_000)
    const exact=await readCompletedEncryptedRecording(id)
    expect(exact.type).toBe('audio/webm')
    const data=new Uint8Array(await exact.arrayBuffer())
    expect(data).toEqual(new Uint8Array([...new Uint8Array(201).fill(11),
      ...new Uint8Array(202).fill(55)]))
    expect((await listEncryptedRecordingDrafts()).map(row=>row.state)).toEqual(['complete'])
    await deleteEncryptedRecordingDraft(id)
    expect(await listEncryptedRecordingDrafts()).toEqual([])
  })

  it('rejects duplicate, missing and simultaneous index writes atomically',async()=>{
    await account()
    const id=await createEncryptedRecordingDraft('video','video/webm')
    await expect(appendEncryptedRecordingSegment(id,1,sample()))
      .rejects.toThrow('camera.recording_sequence_invalid')
    const concurrent=await Promise.allSettled([
      appendEncryptedRecordingSegment(id,0,sample(201,66)),
      appendEncryptedRecordingSegment(id,0,sample(201,77)),
    ])
    expect(concurrent.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(concurrent.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect((await listEncryptedRecordingDrafts())[0]).toMatchObject({
      chunkCount:1,plainBytes:201,state:'writing',
    })
    await appendEncryptedRecordingSegment(id,1,sample(205,88))
    await sealEncryptedRecordingDraft(id,300_000)
    expect((await readCompletedEncryptedRecording(id)).size).toBe(406)
    await expect(appendEncryptedRecordingSegment(id,2,sample()))
      .rejects.toThrow('camera.recording_draft_sealed')
  })

  it('denies short/over-limit and empty completion instead of signing fragments',async()=>{
    await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await expect(sealEncryptedRecordingDraft(id,5000))
      .rejects.toThrow('camera.recording_empty')
    await appendEncryptedRecordingSegment(id,0,sample())
    for(const duration of [0,4_999,3_000_001,NaN]){
      await expect(sealEncryptedRecordingDraft(id,duration))
        .rejects.toThrow('camera.recording_duration_invalid')
    }
    await sealEncryptedRecordingDraft(id,3_000_000)
    expect((await readCompletedEncryptedRecording(id)).size).toBe(200)
  })

  it('keeps interrupted chunks ciphertext-only and refuses implicit salvage or cloud commit',async()=>{
    const s=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/ogg')
    await appendEncryptedRecordingSegment(id,0,sample())
    await interruptEncryptedRecordingDraft(id)
    const [draft]=await listEncryptedRecordingDrafts()
    expect(draft).toMatchObject({
      recordingId:id,kind:'audio',chunkCount:1,state:'interrupted',
    })
    await expect(readCompletedEncryptedRecording(id))
      .rejects.toThrow('camera.recording_not_finalized')
    await expect(sealEncryptedRecordingDraft(id,5000))
      .rejects.toThrow('camera.recording_draft_sealed')
    const {part}=await rawRecording(id,s.accountId)
    expect((part.ciphertext as Blob).type).toBe('application/octet-stream')
  })

  it('survives a harmless session replacement but denies another account and another wrapping key',async()=>{
    const s=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(id,0,sample())
    await sealEncryptedRecordingDraft(id,5000)
    activeSession.value={...s,online:true}
    expect((await readCompletedEncryptedRecording(id)).size).toBe(200)
    const foreign=await account()
    expect(await listEncryptedRecordingDrafts()).toEqual([])
    await expect(readCompletedEncryptedRecording(id))
      .rejects.toThrow('camera.recording_draft_unavailable')
    activeSession.value=s
    const rotated=await account(s.accountId)
    expect(rotated.pkg.wrappingKeyId).not.toBe(s.pkg.wrappingKeyId)
    expect(await listEncryptedRecordingDrafts()).toEqual([])
    await expect(readCompletedEncryptedRecording(id))
      .rejects.toThrow('camera.recording_draft_unavailable')
    activeSession.value=s
    expect((await readCompletedEncryptedRecording(id)).size).toBe(200)
    expect(foreign.accountId).not.toBe(s.accountId)
  })

  it('denies oversized segments before IndexedDB and never increments the offset',async()=>{
    await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await expect(appendEncryptedRecordingSegment(id,0,new Blob([new Uint8Array(8*1024*1024+1)])))
      .rejects.toThrow('camera.recording_segment_invalid')
    expect((await listEncryptedRecordingDrafts())[0]).toMatchObject({
      chunkCount:0,plainBytes:0,
    })
  })

  it('fails closed on tampered on-disk ciphertext and never falls back to raw media',async()=>{
    const s=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(id,0,sample())
    await sealEncryptedRecordingDraft(id,5_000)
    const peek=new Dexie('pb3-encrypted-recording-journal-v1')
    peek.version(1).stores({
      recordings:'&key,accountId,[accountId+createdAt]',
      segments:'&key,recordingKey,[recordingKey+index]',
    })
    try{
      await peek.table('segments').update(s.accountId+'/'+id+'/0',{
        ciphertext:new Blob([new Uint8Array(216).fill(7)],
          {type:'application/octet-stream'}),
      })
    }finally{peek.close()}
    await expect(readCompletedEncryptedRecording(id)).rejects.toThrow()
  })

  it('purges only expired ciphertext from this account, with an exact bound',async()=>{
    const s=await account()
    const first=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(first,0,sample())
    const active=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(active,0,sample())
    const peek=new Dexie('pb3-encrypted-recording-journal-v1')
    peek.version(1).stores({
      recordings:'&key,accountId,[accountId+createdAt]',
      segments:'&key,recordingKey,[recordingKey+index]',
    })
    try{
      await peek.table('recordings').update(s.accountId+'/'+first,{
        expiresAt:Date.now()-1,
      })
      await expect(purgeExpiredEncryptedRecordingDrafts(0))
        .rejects.toThrow('camera.recording_gc_limit_invalid')
      expect(await purgeExpiredEncryptedRecordingDrafts(1)).toBe(1)
      expect(await peek.table('recordings').get(s.accountId+'/'+first)).toBeUndefined()
      expect(await peek.table('segments').get(s.accountId+'/'+first+'/0')).toBeUndefined()
      expect(await peek.table('recordings').get(s.accountId+'/'+active)).toBeDefined()
      expect(await peek.table('segments').get(s.accountId+'/'+active+'/0')).toBeDefined()
      expect(await purgeExpiredEncryptedRecordingDrafts()).toBe(0)
    }finally{peek.close()}
  })

  it('allows explicitly requested account-local interrupted preview but forbids normal publish',async()=>{
    const session=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(id,0,sample(222,17))
    await appendEncryptedRecordingSegment(id,1,sample(223,26))
    await interruptEncryptedRecordingDraft(id)
    await expect(readCompletedEncryptedRecording(id))
      .rejects.toThrow('camera.recording_not_finalized')
    const reviewed=await readEncryptedRecordingForPrivateReview(id)
    expect(reviewed.size).toBe(445)
    expect(reviewed.type).toBe('audio/webm')
    expect(new Uint8Array(await reviewed.arrayBuffer())).toEqual(
      new Uint8Array([...new Uint8Array(222).fill(17),
        ...new Uint8Array(223).fill(26)]))
    const {part}=await rawRecording(id,session.accountId)
    expect((part.ciphertext as Blob).type).toBe('application/octet-stream')
    expect((part.ciphertext as Blob).size).toBe(238)
    expect((await listEncryptedRecordingDrafts())[0]?.state).toBe('interrupted')
  })

  it('refuses review of unsealed writing segments, wrong account or tampered ciphertext',async()=>{
    const s=await account()
    const id=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(id,0,sample())
    await expect(readEncryptedRecordingForPrivateReview(id))
      .rejects.toThrow('camera.recording_not_finalized')
    await interruptEncryptedRecordingDraft(id)
    const foreign=await account()
    await expect(readEncryptedRecordingForPrivateReview(id))
      .rejects.toThrow('camera.recording_draft_unavailable')
    expect(foreign.accountId).not.toBe(s.accountId)
    activeSession.value=s
    const peek=new Dexie('pb3-encrypted-recording-journal-v1')
    peek.version(1).stores({
      recordings:'&key,accountId,[accountId+createdAt]',
      segments:'&key,recordingKey,[recordingKey+index]',
    })
    try{
      await peek.table('segments').update(s.accountId+'/'+id+'/0',{
        ciphertext:new Blob([new Uint8Array(216).fill(99)],
          {type:'application/octet-stream'}),
      })
    }finally{peek.close()}
    await expect(readEncryptedRecordingForPrivateReview(id)).rejects.toThrow()
  })

  it('refuses an already-untrusted/unsupported MediaRecorder format',async()=>{
    await account()
    await expect(createEncryptedRecordingDraft('audio','application/octet-stream'))
      .rejects.toThrow('camera.recording_mime_invalid')
    await expect(createEncryptedRecordingDraft('video','audio/webm'))
      .rejects.toThrow('camera.recording_mime_invalid')
  })

  // LAST test by design: Panic erasure locks the module's current JS realm.
  it('erases ALL accounts local ciphertext even after session loss, then denies new writes',async()=>{
    const accountA=await account()
    const one=await createEncryptedRecordingDraft('audio','audio/webm')
    await appendEncryptedRecordingSegment(one,0,sample())
    const accountB=await account()
    const two=await createEncryptedRecordingDraft('video','video/webm')
    await appendEncryptedRecordingSegment(two,0,sample())
    activeSession.value=null
    await eraseAllEncryptedRecordingScratchForPanic()
    const peek=new Dexie('pb3-encrypted-recording-journal-v1')
    peek.version(1).stores({
      recordings:'&key,accountId,[accountId+createdAt]',
      segments:'&key,recordingKey,[recordingKey+index]',
    })
    try{
      expect(await peek.table('recordings').count()).toBe(0)
      expect(await peek.table('segments').count()).toBe(0)
    }finally{peek.close()}
    activeSession.value=accountA
    await expect(createEncryptedRecordingDraft('audio','audio/webm'))
      .rejects.toThrow('camera.recording_scratch_wiped')
    activeSession.value=accountB
    await expect(appendEncryptedRecordingSegment(two,1,sample()))
      .rejects.toThrow('camera.recording_scratch_wiped')
    expect(one).not.toBe(two)
  })
})
