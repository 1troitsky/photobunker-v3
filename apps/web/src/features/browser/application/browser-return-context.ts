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
}
let source:BrowserReturnContext|null=null
let armed=false

export function captureBrowserReturnContext(context:BrowserReturnContext):void{
  source={...context}
  armed=false
}
export function discardBrowserReturnContext():void{
  source=null
  armed=false
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
    &&source.deviceId===deviceId?{...source}:null
  discardBrowserReturnContext()
  return context
}
