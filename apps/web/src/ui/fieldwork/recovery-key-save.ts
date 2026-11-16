/**
 * Explicit one-time Recovery Key export. No anonymous anchor download, no
 * network upload, no persistent browser copy, and no automatic 'saved' ACK.
 * Never log the supplied key or include it in error/telemetry messages.
 */
export type RecoveryKeyExportResult='saved'|'shared'|'cancelled'|'unsupported'|'failed'
type Writable={
  write(data:Blob):Promise<void>
  close():Promise<void>
  abort?():Promise<void>
}
type FileHandle={createWritable():Promise<Writable>}
type PickerWindow=Window & {
  showSaveFilePicker?:(opts:{
    suggestedName:string
    types:{description:string;accept:Record<string,string[]>}[]
  })=>Promise<FileHandle>
}
type FileShareNavigator=Navigator & {
  canShare?:(data:{files:File[]})=>boolean
  share?:(data:{files:File[];title:string})=>Promise<void>
}
function wasCancelled(e:unknown):boolean{
  return e instanceof DOMException&&e.name==='AbortError'
    ||(typeof e==='object'&&e!==null&&'name' in e
      &&(e as {name:unknown}).name==='AbortError')
}
export async function saveRecoveryKeyWithSystemDialog(
  key:string,brandSlug:string,
):Promise<RecoveryKeyExportResult>{
  if(!key||!brandSlug||!/^[a-z0-9-]+$/.test(brandSlug))return 'failed'
  if(typeof window==='undefined'||typeof navigator==='undefined')
    return 'unsupported'
  const name=brandSlug+'-Recovery-Key.txt'
  const file=new File([key+'\n'],name,{type:'text/plain;charset=utf-8'})
  // Picker must be invoked synchronously from the originating click.
  const picker=(window as PickerWindow).showSaveFilePicker
  if(typeof picker==='function'){
    let writable:Writable|undefined
    try{
      const handle=await picker({
        suggestedName:name,
        types:[{description:'Text file',accept:{'text/plain':['.txt']}}],
      })
      writable=await handle.createWritable()
      await writable.write(file)
      await writable.close()
      return 'saved'
    }catch(e){
      if(writable){
        try{await writable.abort?.()}catch{/* no sensitive data in UI errors */}
      }
      return wasCancelled(e)?'cancelled':'failed'
    }
  }
  // Safari/iOS may expose only the OS share sheet. This is explicit,
  // user-selected and NOT proof the key has been stored locally.
  const share=navigator as FileShareNavigator
  if(typeof share.canShare==='function'&&typeof share.share==='function'){
    try{
      if(!share.canShare({files:[file]}))return 'unsupported'
      await share.share({files:[file],title:'Recovery Key'})
      return 'shared'
    }catch(e){return wasCancelled(e)?'cancelled':'failed'}
  }
  return 'unsupported'
}
