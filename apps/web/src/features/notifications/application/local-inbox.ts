import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession, type Session } from '../../identity/application/session'
import { b64, unb64, random, digest, hex } from '../../identity/infrastructure/crypto'

// The inbox is an encrypted LOCAL projection only. Its entries confer no
// authorization, are not an ACK of server delivery, and cannot execute actions.
const INDEX_DOMAIN='pb3.notification-index.v1\n'
const AAD_DOMAIN='pb3.notification-row.v1\n'
const encoder=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX=/^[a-f0-9]{64}$/
const MAX_ROWS=10000

export const notificationKinds=[
  'assignment-invite','team-invite','assignment-deadline','new-file',
  'media-review','file-expiry','backup','subscription','security',
] as const
export type NotificationKind=typeof notificationKinds[number]

export type LocalNotificationInput=Readonly<{
  id:string
  kind:NotificationKind
  targetId:string|null
  occurredAt:number
}>
export type LocalNotification=Readonly<LocalNotificationInput & {
  version:1
  origin:'local'
  readAt:number|null
}>
export type NotificationPreview=Readonly<{
  id:string
  kind:NotificationKind
  occurredAt:number
  read:boolean
  title:string
  description:string
}>

type CipherRow={
  key:string
  ownerScope:string
  etag:string
  iv:string
  ciphertext:string
}
class NotificationDB extends Dexie{
  rows!:Table<CipherRow,string>
  constructor(){
    super('pb3-encrypted-notifications-v1')
    this.version(1).stores({rows:'&key,ownerScope'})
  }
}
const db=new NotificationDB()

const messages:Record<NotificationKind,readonly [string,string]>={
  'assignment-invite':['Приглашение в задание','Откройте приложение, чтобы проверить приглашение.'],
  'team-invite':['Приглашение в команду','Проверьте приглашение в приложении.'],
  'assignment-deadline':['Срок задания','Проверьте срок задания и свои права доступа.'],
  'new-file':['Новые материалы','Доступность файлов необходимо проверить.'],
  'media-review':['Проверка материалов','Откройте приложение, чтобы проверить материалы.'],
  'file-expiry':['Удаление файла','Проверьте срок хранения файла.'],
  'backup':['Резервная копия','Проверьте состояние резервного копирования.'],
  'subscription':['Подписка','Проверьте состояние подписки.'],
  'security':['Событие безопасности','Проверьте настройки безопасности.'],
}
const requireTarget=new Set<NotificationKind>([
  'assignment-invite','team-invite','assignment-deadline',
  'new-file','media-review','file-expiry',
])

function isKind(value:unknown):value is NotificationKind{
  return typeof value==='string' &&
    Object.prototype.hasOwnProperty.call(messages,value)
}
function sameIdentity(session:Session):void{
  const current=activeSession.value
  // Offline login proof may replace the Session object, but the account,
  // device, AKEK and key revision must stay identical.
  if(!current||current.accountId!==session.accountId
    ||current.deviceId!==session.deviceId
    ||current.pkg.akek!==session.pkg.akek
    ||current.pkg.accountSpki!==session.pkg.accountSpki
    ||current.pkg.revision!==session.pkg.revision)
    throw Error('notifications.identity_changed')
}
function validateInput(value:unknown):asserts value is LocalNotificationInput{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('notifications.invalid_event')
  const v=value as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!=='id|kind|occurredAt|targetId'
    ||typeof v.id!=='string'||!UUID.test(v.id)
    ||!isKind(v.kind)
    ||typeof v.occurredAt!=='number'
    ||!Number.isSafeInteger(v.occurredAt)||v.occurredAt<0
    ||(v.targetId!==null &&
      (typeof v.targetId!=='string'||!UUID.test(v.targetId)))
    ||requireTarget.has(v.kind)&&v.targetId===null
    ||!requireTarget.has(v.kind)&&v.targetId!==null)
    throw Error('notifications.invalid_event')
}
function validateRecord(value:unknown):asserts value is LocalNotification{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('notifications.invalid_record')
  const v=value as Record<string,unknown>
  if(Object.keys(v).sort().join('|')!=='id|kind|occurredAt|origin|readAt|targetId|version'
    ||v.version!==1||v.origin!=='local'
    ||v.readAt!==null && (typeof v.readAt!=='number'
      ||!Number.isSafeInteger(v.readAt)
      ||v.readAt<(v.occurredAt as number)))
    throw Error('notifications.invalid_record')
  validateInput({
    id:v.id,kind:v.kind,targetId:v.targetId,occurredAt:v.occurredAt,
  })
}
async function shaId(value:string):Promise<string>{
  return hex(await digest(encoder.encode(value)))
}
async function keys(session:Session,id?:string):Promise<{ownerScope:string;key?:string}>{
  const ownerScope=await shaId(INDEX_DOMAIN+session.accountId)
  return {ownerScope,key:id?
    await shaId(INDEX_DOMAIN+session.accountId+'\n'+id):undefined}
}
function aad(ownerScope:string,key:string):Uint8Array<ArrayBuffer>{
  return encoder.encode(AAD_DOMAIN+ownerScope+'\n'+key)
}
async function cryptoKey(session:Session,usage:KeyUsage):Promise<CryptoKey>{
  const bytes=unb64(session.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,[usage])}
  finally{bytes.fill(0)}
}
async function decryptRow(row:CipherRow,session:Session,ownerScope:string):Promise<LocalNotification>{
  if(row.ownerScope!==ownerScope||!HEX.test(row.key)
    ||typeof row.etag!=='string'
    ||!/^[A-Za-z0-9_-]{16}$/.test(row.etag))
    throw Error('notifications.invalid_row')
  let bytes:ArrayBuffer
  try{
    bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:aad(row.ownerScope,row.key),tagLength:128,
    },await cryptoKey(session,'decrypt'),unb64(row.ciphertext))
  }catch{throw Error('notifications.encrypted_record_unreadable')}
  let event:unknown
  try{event=JSON.parse(decoder.decode(bytes));validateRecord(event)}
  catch{throw Error('notifications.invalid_record')}
  const expected=await keys(session,(event as LocalNotification).id)
  if(expected.key!==row.key)
    throw Error('notifications.invalid_record_scope')
  sameIdentity(session)
  return event as LocalNotification
}
async function encryptRow(
  value:LocalNotification,session:Session,ownerScope:string,key:string,
):Promise<CipherRow>{
  validateRecord(value)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(ownerScope,key),tagLength:128,
  },await cryptoKey(session,'encrypt'),encoder.encode(JSON.stringify(value)))
  sameIdentity(session)
  return {key,ownerScope,etag:b64(random(12)),iv:b64(iv),ciphertext:b64(ciphertext)}
}

/**
 * Per-row optimistic compare-and-swap prevents concurrent tabs overwriting a
 * read acknowledgement or accepting mutated duplicate event IDs. Crypto runs
 * OUTSIDE IndexedDB transactions; the CAS check and put are atomic.
 */
async function modify(
  session:Session,id:string,
  change:(existing:LocalNotification|null)=>LocalNotification|null,
):Promise<LocalNotification|null>{
  const {ownerScope,key}=await keys(session,id)
  if(!key)throw Error('notifications.invalid_event')
  for(let attempt=0;attempt<8;attempt++){
    sameIdentity(session)
    const previous=await db.rows.get(key)
    const existing=previous?await decryptRow(previous,session,ownerScope):null
    const next=change(existing)
    if(next===null){
      sameIdentity(session)
      return existing
    }
    validateRecord(next)
    if(next.id!==id)throw Error('notifications.invalid_record_scope')
    const prepared=await encryptRow(next,session,ownerScope,key)
    try{
      await db.transaction('rw',db.rows,async()=>{
        const latest=await db.rows.get(key)
        if((latest?.etag??null)!==(previous?.etag??null))
          throw Error('notifications.stale_write')
        sameIdentity(session)
        await db.rows.put(prepared)
      })
      sameIdentity(session)
      return next
    }catch(error){
      if(!(error instanceof Error)||error.message!=='notifications.stale_write')
        throw error
    }
  }
  throw Error('notifications.concurrent_update')
}

/** Locally observed events only; callers must not infer remote approval. */
export async function recordLocalNotification(input:LocalNotificationInput):Promise<LocalNotification>{
  validateInput(input)
  const session=requireSession()
  const result=await modify(session,input.id,previous=>{
    if(previous){
      // ID is immutable. Duplicate delivery must never clear a read marker
      // or replace the event kind or destination.
      if(previous.kind!==input.kind||previous.targetId!==input.targetId
        ||previous.occurredAt!==input.occurredAt)
        throw Error('notifications.duplicate_conflict')
      return null
    }
    return {version:1,origin:'local',...input,readAt:null}
  })
  if(!result)throw Error('notifications.invalid_record')
  return result
}

export async function listLocalNotifications(options?:{unreadOnly?:boolean}):Promise<LocalNotification[]>{
  const session=requireSession()
  const {ownerScope}=await keys(session)
  sameIdentity(session)
  const rows=await db.rows.where('ownerScope').equals(ownerScope).limit(MAX_ROWS+1).toArray()
  if(rows.length>MAX_ROWS)throw Error('notifications.inbox_limit')
  const events:LocalNotification[]=[]
  for(const row of rows){
    sameIdentity(session)
    const event=await decryptRow(row,session,ownerScope)
    if(!options?.unreadOnly||event.readAt===null)events.push(event)
  }
  sameIdentity(session)
  return events.sort((a,b)=>b.occurredAt-a.occurredAt||a.id.localeCompare(b.id))
}

/** Local read acknowledgement; does not send a server read receipt. */
export async function markNotificationRead(id:string,at=Date.now()):Promise<LocalNotification|null>{
  if(!UUID.test(id)||!Number.isSafeInteger(at)||at<0)
    throw Error('notifications.invalid_read')
  const session=requireSession()
  return modify(session,id,event=>{
    if(!event||event.readAt!==null)return null
    return {...event,readAt:Math.max(event.occurredAt,at)}
  })
}
export async function markAllLocalNotificationsRead(at=Date.now()):Promise<number>{
  if(!Number.isSafeInteger(at)||at<0)throw Error('notifications.invalid_read')
  const session=requireSession()
  const events=await listLocalNotifications({unreadOnly:true})
  let changed=0
  for(const event of events){
    sameIdentity(session)
    const result=await markNotificationRead(event.id,at)
    if(result?.readAt!==null)changed++
  }
  sameIdentity(session)
  return changed
}
export async function localUnreadCount():Promise<number>{
  return (await listLocalNotifications({unreadOnly:true})).length
}

/** Safe preview only. Target IDs never become privileged deep links here. */
export function previewNotification(event:LocalNotification):NotificationPreview{
  validateRecord(event)
  const [title,description]=messages[event.kind]
  return {id:event.id,kind:event.kind,occurredAt:event.occurredAt,
    read:event.readAt!==null,title,description}
}
