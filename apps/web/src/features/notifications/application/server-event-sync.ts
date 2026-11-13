import { jsonApi } from '../../identity/infrastructure/api'
import { activeSession, requireSession } from '../../identity/application/session'
import { recordLocalNotification, type LocalNotificationInput } from './local-inbox'

/**
 * Replays the server's trusted metadata-only feed into the encrypted local
 * inbox. A response is NOT an ACK; every page is advanced only after AES-GCM
 * IndexedDB writes complete. Re-starting at zero after reload is deliberate:
 * it trades bandwidth for no loss across crashes without an unsafe plaintext
 * persisted cursor. Call explicitly after authenticated online login.
 */
type FeedPage={schemaVersion:1;items:LocalNotificationInput[];nextCursor:string;hasMore:boolean}
const MAX_PAGES=220 // 11k server rows at 50/page; local inbox caps at 10k
const MAX_CURSOR=9007199254740991
const cursorPattern=/^(?:0|[1-9][0-9]{0,15})$/

function cursor(value:unknown):number{
  if(typeof value!=='string'||!cursorPattern.test(value))
    throw Error('notifications.invalid_cursor')
  const n=Number(value)
  if(!Number.isSafeInteger(n)||n<0||n>MAX_CURSOR)
    throw Error('notifications.invalid_cursor')
  return n
}
function parsePage(raw:unknown,previous:number):FeedPage{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('notifications.invalid_feed')
  const v=raw as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!=='hasMore|items|nextCursor|schemaVersion'
    ||v.schemaVersion!==1||typeof v.hasMore!=='boolean'
    ||!Array.isArray(v.items)||v.items.length>50)
    throw Error('notifications.invalid_feed')
  const next=cursor(v.nextCursor)
  // All scanned rows may be ACL-filtered; a cursor can advance with 0 items.
  if(next<previous||v.hasMore&&next===previous)
    throw Error('notifications.invalid_feed')
  // Each item is additionally validated by the strict encrypted inbox writer.
  return v as FeedPage
}
function sameSession(accountId:string,deviceId:string,akek:string):void{
  const now=activeSession.value
  if(!now||now.accountId!==accountId||now.deviceId!==deviceId
    ||now.pkg.akek!==akek||!now.online)
    throw Error('notifications.session_changed')
}

/** Replays from the beginning; server never receives a read ACK. */
export async function syncServerNotifications():Promise<{saved:number;pages:number}>{
  const session=requireSession()
  if(!session.online)throw Error('notifications.offline')
  const {accountId,deviceId}=session,akek=session.pkg.akek
  let after=0,saved=0
  for(let pages=0;pages<MAX_PAGES;pages++){
    sameSession(accountId,deviceId,akek)
    const raw=await jsonApi<unknown>('/notifications/v1/events?after='+after)
    sameSession(accountId,deviceId,akek)
    const page=parsePage(raw,after)
    for(const item of page.items){
      sameSession(accountId,deviceId,akek)
      await recordLocalNotification(item)
      // No network cursor advancement after failed/mutated encrypted write.
      sameSession(accountId,deviceId,akek)
      saved++
    }
    after=cursor(page.nextCursor)
    if(!page.hasMore)return {saved,pages:pages+1}
  }
  throw Error('notifications.feed_limit')
}

/**
 * Single-flight lifecycle used by the Shell. No timer, no background service
 * worker and no implicit privilege; online/visibility events only initiate
 * another idempotent encrypted replay for the currently authenticated session.
 * A network failure leaves existing encrypted records intact.
 */
let running:Promise<void>|null=null
export function requestNotificationSync():Promise<void>{
  if(running)return running
  const session=activeSession.value
  if(!session?.online)return Promise.resolve()
  const task=syncServerNotifications().then(()=>undefined)
  const safe=task.catch(()=>{ /* Safe replay at next online/visible event. */ })
  running=safe.finally(()=>{running=null})
  return running
}

export function attachNotificationSyncLifecycle():void{
  if(typeof window==='undefined'||typeof document==='undefined')return
  window.addEventListener('online',()=>{void requestNotificationSync()})
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&navigator.onLine)
      void requestNotificationSync()
  })
}

/**
 * Resolve ONLY a server-stored event ID at the moment of a user click.
 * A cached local targetId never authorizes navigation or grants media read.
 * Callers must still perform the regular protected media fetch afterwards.
 */
export async function resolveNotificationTarget(eventId:string):Promise<{kind:'new-file';targetId:string}>{
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  if(!uuid.test(eventId))throw Error('notifications.invalid_target')
  const session=requireSession()
  if(!session.online)throw Error('notifications.offline')
  const {accountId,deviceId}=session,akek=session.pkg.akek
  sameSession(accountId,deviceId,akek)
  const raw=await jsonApi<unknown>('/notifications/v1/events/'+eventId+'/target')
  sameSession(accountId,deviceId,akek)
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw Error('notifications.invalid_target')
  const value=raw as Record<string,unknown>
  if(Object.keys(value).sort().join('|')!=='kind|schemaVersion|targetId'
    ||value.schemaVersion!==1||value.kind!=='new-file'
    ||typeof value.targetId!=='string'||!uuid.test(value.targetId))
    throw Error('notifications.invalid_target')
  return {kind:'new-file',targetId:value.targetId}
}
