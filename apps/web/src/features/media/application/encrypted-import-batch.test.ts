import {describe,expect,it,vi} from 'vitest'
import {
  enqueueEncryptedImportBatch,validateEncryptedImportBatch,
  MAX_MEDIA_IMPORT_BATCH_BYTES,MAX_MEDIA_IMPORT_FILES,
} from './encrypted-import-batch'
const file=(name:string,size=1024)=>({name,size}) as File

describe('P2 V-36 bounded E2EE multi-file import — durable partial successes',()=>{
  it('validates count, individual size and cumulative load before encrypting anything',()=>{
    expect(()=>validateEncryptedImportBatch([file('a')])).not.toThrow()
    expect(()=>validateEncryptedImportBatch([]))
      .toThrow('media.import_file_count_limit')
    expect(()=>validateEncryptedImportBatch(
      Array.from({length:MAX_MEDIA_IMPORT_FILES+1},(_,i)=>file('x'+i))))
      .toThrow('media.import_file_count_limit')
    expect(()=>validateEncryptedImportBatch([file('empty',0)]))
      .toThrow('media.import_file_size_limit')
    expect(()=>validateEncryptedImportBatch([file('too large',128*1024*1024+1)]))
      .toThrow('media.import_file_size_limit')
    expect(()=>validateEncryptedImportBatch([file('large1',128*1024*1024),
      file('large2',128*1024*1024),file('more',1)]))
      .toThrow('media.import_batch_size_limit')
    expect(MAX_MEDIA_IMPORT_BATCH_BYTES).toBe(256*1024*1024)
  })
  it('encrypts each selected file individually without discarding good queued originals',async()=>{
    const selected=[file('first.wav'),file('broken.webp'),file('third.mp4')]
    const queue=vi.fn(async(f:File)=>{
      if(f.name==='broken.webp')throw Error('media.unsupported_mime')
      return 'id:'+f.name
    })
    await expect(enqueueEncryptedImportBatch(selected,queue,()=>true))
      .resolves.toEqual({mediaIds:['id:first.wav','id:third.mp4'],
        failed:1,cancelled:false})
    expect(queue.mock.calls.map(([f])=>f.name)).toEqual(
      ['first.wav','broken.webp','third.mp4'])
  })
  it('does not queue any file when a session changes before start or during AES-GCM',async()=>{
    const files=[file('first.wav'),file('second.wav')]
    const queue=vi.fn(async(f:File)=>'id:'+f.name)
    await expect(enqueueEncryptedImportBatch(files,queue,()=>false))
      .resolves.toEqual({mediaIds:[],failed:0,cancelled:true})
    expect(queue).not.toHaveBeenCalled()
    let same=true
    const changing=vi.fn(async(f:File)=>{
      same=false
      return 'id:'+f.name
    })
    await expect(enqueueEncryptedImportBatch(files,changing,()=>same))
      .resolves.toEqual({mediaIds:[],failed:0,cancelled:true})
    expect(changing).toHaveBeenCalledTimes(1)
  })
  it('preflight rejects oversized sets without initiating file encryption',async()=>{
    const queue=vi.fn(async()=>'never')
    await expect(enqueueEncryptedImportBatch(
      Array.from({length:MAX_MEDIA_IMPORT_FILES+1},()=>file('x')),queue,
      ()=>true)).rejects.toThrow('media.import_file_count_limit')
    expect(queue).not.toHaveBeenCalled()
  })
})
