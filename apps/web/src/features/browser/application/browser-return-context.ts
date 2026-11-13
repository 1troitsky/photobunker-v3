import type {CatalogFilter,CatalogSort,CatalogView} from './catalog'

/**
 * Browser -> File Viewer -> Browser navigation memory.
 * This is tab-volatile UI context only: no localStorage, IndexedDB, URL query,
 * server request, encrypted folder-name export, or account-wide persistence.
 * File access is ALWAYS rechecked by the normal per-file ACL and E2EE reader.
 */
export type BrowserReturnContext={
  accountId:string
  deviceId:string
  fileKey:string
  folderId:string|null
  filter:CatalogFilter
  sort:CatalogSort
  view:CatalogView
  search:string
  searchFolderScope:'current'|'all'
  archiveTab:'all'|'archive'
  // Order of already-visible, authorized opaque catalog keys, not decrypted data.
  fileKeys:string[]
}
let source:BrowserReturnContext|null=null
let armed=false

export function captureBrowserReturnContext(context:BrowserReturnContext):void{
  // Avoid storing a huge or ambiguous navigation list in volatile memory.
  const keys=context.fileKeys
  if(keys.length>10000||new Set(keys).size!==keys.length
    ||!keys.includes(context.fileKey)){
    source=null;armed=false;return
  }
  source={...context,fileKeys:[...keys]}
  armed=false
}
export function discardBrowserReturnContext():void{
  source=null
  armed=false
}
export type OriginNeighbor={source:'photo'|'media';id:string}
export type OriginPager={
  previous:OriginNeighbor|null;next:OriginNeighbor|null
  position:number;total:number
}
function parseNeighbor(key:string|undefined):OriginNeighbor|null{
  if(!key)return null
  const match=/^(photo|media):([a-f0-9-]{36})$/.exec(key)
  return match?{source:match[1] as 'photo'|'media',id:match[2]!}:null
}
/**
 * File Viewer uses exactly the already loaded Browser order, including the
 * selected folder, media filter, search and sorting. This is UI context, not
 * proof of authorization; opening an item still goes through ACL + E2EE.
 */
export function peekOriginPager(
  accountId:string,deviceId:string,currentKey:string,
):OriginPager|null{
  if(!source||source.accountId!==accountId||source.deviceId!==deviceId)
    return null
  const index=source.fileKeys.indexOf(currentKey)
  if(index<0)return null
  return {
    previous:parseNeighbor(source.fileKeys[index-1]),
    next:parseNeighbor(source.fileKeys[index+1]),
    position:index+1,total:source.fileKeys.length,
  }
}
/** After Viewer next/previous, return to the current file in Browser. */
export function noteViewerPosition(
  accountId:string,deviceId:string,fileKey:string,
):void{
  if(source&&source.accountId===accountId&&source.deviceId===deviceId
    &&source.fileKeys.includes(fileKey))source.fileKey=fileKey
}
/** Only an actual Viewer -> Browser route transition can authorize a restore. */
export function armBrowserReturn(accountId:string,deviceId:string):void{
  if(!source||source.accountId!==accountId||source.deviceId!==deviceId){
    discardBrowserReturnContext()
    return
  }
  armed=true
}
/** One-shot and identity-bound. A new tab / hard reload safely starts at root. */
export function takeBrowserReturn(
  accountId:string,deviceId:string,
):BrowserReturnContext|null{
  const context=armed&&source?.accountId===accountId
    &&source.deviceId===deviceId
    ?{...source,fileKeys:[...source.fileKeys]}:null
  discardBrowserReturnContext()
  return context
}
