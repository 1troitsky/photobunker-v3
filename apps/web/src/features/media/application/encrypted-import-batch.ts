import {MAX_MEDIA_BYTES} from '../domain/media-crypto'

export const MAX_MEDIA_IMPORT_FILES=20
export const MAX_MEDIA_IMPORT_BATCH_BYTES=256*1024*1024

/** Separate operational UI bound, never a subscription entitlement. */
export function validateEncryptedImportBatch(
  files:ReadonlyArray<Pick<File,'size'>>,
):void{
  if(files.length<1||files.length>MAX_MEDIA_IMPORT_FILES)
    throw Error('media.import_file_count_limit')
  let total=0
  for(const file of files){
    if(!Number.isSafeInteger(file.size)||file.size<1
      ||file.size>MAX_MEDIA_BYTES)
      throw Error('media.import_file_size_limit')
    total+=file.size
    if(total>MAX_MEDIA_IMPORT_BATCH_BYTES)
      throw Error('media.import_batch_size_limit')
  }
}
export type EncryptedImportBatchResult={
  mediaIds:string[];failed:number;cancelled:boolean
}

/**
 * Every successful enqueue is durable, independent AES-GCM encrypted media.
 * A later invalid file must NEVER roll back earlier valid media or remove
 * the outbox. A changed account/session stops further work immediately;
 * old-account local encrypted media remains in that account's own outbox.
 */
export async function enqueueEncryptedImportBatch(
  files:readonly File[],
  encryptAndQueue:(file:File)=>Promise<string>,
  stillCurrent:()=>boolean,
):Promise<EncryptedImportBatchResult>{
  validateEncryptedImportBatch(files)
  const mediaIds:string[]=[]
  let failed=0
  for(const file of files){
    if(!stillCurrent())return {mediaIds,failed,cancelled:true}
    try{
      const id=await encryptAndQueue(file)
      if(!stillCurrent())return {mediaIds,failed,cancelled:true}
      mediaIds.push(id)
    }catch{
      if(!stillCurrent())return {mediaIds,failed,cancelled:true}
      failed++
    }
  }
  return {mediaIds,failed,cancelled:false}
}
