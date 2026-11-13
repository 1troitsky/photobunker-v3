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
