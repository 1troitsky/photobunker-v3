import {watch} from 'vue'
import {activeSession} from '../../identity/application/session'
import type {CatalogFilter,CatalogSort,CatalogView} from './catalog'

export type BrowserReturnContext={
  folderId:string|null
  filter:CatalogFilter;sort:CatalogSort;view:CatalogView
  query:string;searchScope:'current'|'all'
  archiveTab:'all'|'archive';expandedSearch:boolean
  focusKey:string;scrollTop:number
}
type Pending={
  accountId:string;deviceId:string;createdAt:number
  context:BrowserReturnContext
}
const TTL_MS=15*60*1000
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
let pending:Pending|null=null

/**
 * This is *only* ephemeral state in the current JS tab. Never store search
 * strings, private folder names/IDs or position in URL, history.state,
 * localStorage, IndexedDB, telemetry or a server API.
 */
export function rememberBrowserViewerReturn(context:BrowserReturnContext):void{
  const identity=activeSession.value
  if(!identity
    ||context.query.length>160
    ||context.folderId!==null&&!uuid.test(context.folderId)
    ||!(/^(photo|media):/.test(context.focusKey)
      &&uuid.test(context.focusKey.split(':')[1]??''))
    ||!Number.isSafeInteger(context.scrollTop)
    ||context.scrollTop<0||context.scrollTop>10000000){
    pending=null
    return
  }
  pending={
    accountId:identity.accountId,deviceId:identity.deviceId,
    createdAt:Date.now(),context:{...context},
  }
}
/**
 * Consume once. Session/device binding and a short lifetime prevent
 * leaking a prior account's volatile search or folder into another login.
 */
export function takeBrowserViewerReturn():BrowserReturnContext|null{
  const identity=activeSession.value,previous=pending
  pending=null
  if(!identity||!previous
    ||Date.now()-previous.createdAt>TTL_MS
    ||Date.now()<previous.createdAt
    ||previous.accountId!==identity.accountId
    ||previous.deviceId!==identity.deviceId)return null
  return {...previous.context}
}
export function clearBrowserViewerReturn():void{pending=null}

/** A real identity key/device boundary wipes the only in-memory copy. */
watch(activeSession,(next,previous)=>{
  if(next?.accountId!==previous?.accountId
    ||next?.deviceId!==previous?.deviceId
    ||next?.pkg!==previous?.pkg
    ||next?.device!==previous?.device)
    pending=null
})
