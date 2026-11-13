import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeSession, type Session } from '../../identity/application/session'
import { b64, random, freshPackage, digest, hex } from '../../identity/infrastructure/crypto'
import {
  localUnreadCount, listLocalNotifications, markAllLocalNotificationsRead,
  markNotificationRead, previewNotification, recordLocalNotification,
  readNotificationPreferences, saveNotificationPreferences, notificationIsVisible,
  defaultNotificationPreferences,
  type LocalNotificationInput,
} from './local-inbox'

type RawRow={key:string;ownerScope:string;etag:string;iv:string;ciphertext:string}
const eventId='44444444-4444-4444-8444-444444444444'
const targetId='55555555-5555-4555-8555-555555555555'
let ownerId:string
async function session(id=ownerId):Promise<Session>{
  const {pkg}=await freshPackage(id)
  const value={accountId:id,deviceId:crypto.randomUUID(),pkg,online:false} as Session
  activeSession.value=value
  return value
}
function input(id=eventId):LocalNotificationInput{
  return {id,kind:'assignment-invite',targetId,occurredAt:1_750_000_000_000}
}
async function rows():Promise<RawRow[]>{
  const db=new Dexie('pb3-encrypted-notifications-v1')
  db.version(2).stores({rows:'&key,ownerScope',preferences:'&key'})
  const ownerScope=hex(await digest(new TextEncoder().encode(
    'pb3.notification-index.v1\n'+ownerId)))
  const result=await db.table('rows').where('ownerScope').equals(ownerScope).toArray() as RawRow[]
  db.close()
  return result
}
beforeEach(()=>{ownerId=crypto.randomUUID()})
afterEach(()=>{activeSession.value=null})

describe('PB3 encrypted Local-First notifications',()=>{
  it('encrypts display preferences with account isolation and persistence',async()=>{
    const alice=await session()
    expect(await readNotificationPreferences()).toEqual(defaultNotificationPreferences)
    const preferences={...defaultNotificationPreferences,
      invitations:false,expiry:false,badges:false}
    await saveNotificationPreferences(preferences)
    expect(await readNotificationPreferences()).toEqual(preferences)
    expect(notificationIsVisible('team-invite',preferences)).toBe(false)
    expect(notificationIsVisible('new-file',preferences)).toBe(true)
    expect(notificationIsVisible('file-expiry',preferences)).toBe(false)
    expect(notificationIsVisible('security',preferences)).toBe(true)

    const raw=new Dexie('pb3-encrypted-notifications-v1')
    raw.version(2).stores({rows:'&key,ownerScope',preferences:'&key'})
    const stored=await raw.table('preferences').toArray()
    expect(stored).toHaveLength(1)
    const serialized=JSON.stringify(stored)
    expect(serialized).not.toContain(alice.accountId)
    expect(serialized).not.toContain('invitations')
    expect(serialized).not.toContain('badges')
    raw.close()
    const bob=await session(crypto.randomUUID())
    expect(await readNotificationPreferences()).toEqual(defaultNotificationPreferences)
    activeSession.value=alice
    expect(await readNotificationPreferences()).toEqual(preferences)
    expect(bob.accountId).not.toBe(alice.accountId)
  })
  it('rejects invalid preference shape and tampered ciphertext without applying it',async()=>{
    await session()
    await expect(saveNotificationPreferences({
      ...defaultNotificationPreferences,security:false,
    } as unknown as typeof defaultNotificationPreferences))
      .rejects.toThrow('notifications.invalid_preferences')
    const original={...defaultNotificationPreferences,deadlines:false}
    await saveNotificationPreferences(original)
    const raw=new Dexie('pb3-encrypted-notifications-v1')
    raw.version(2).stores({rows:'&key,ownerScope',preferences:'&key'})
    const stored=await raw.table('preferences').toArray()
    const row=stored[0]!
    await raw.table('preferences').put({...row,iv:b64(random(12))})
    await expect(readNotificationPreferences())
      .rejects.toThrow('notifications.encrypted_preferences_unreadable')
    raw.close()
  })
  it('encrypts event contents, targets, timestamps and read state at rest',async()=>{
    const alice=await session()
    const item=await recordLocalNotification(input())
    expect(item).toMatchObject({id:eventId,origin:'local',readAt:null})
    const stored=await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]!.etag).toHaveLength(16)
    const json=JSON.stringify(stored)
    expect(json).not.toContain(alice.accountId)
    expect(json).not.toContain(eventId)
    expect(json).not.toContain(targetId)
    expect(json).not.toContain('assignment-invite')
    expect(json).not.toContain('1750000000000')
    expect(await localUnreadCount()).toBe(1)
    const preview=previewNotification(item)
    expect(preview).toMatchObject({title:'Приглашение в задание',read:false})
    expect(JSON.stringify(preview)).not.toContain(targetId)
  })
  it('survives offline reload, deduplicates and never clears a read marker on replay',async()=>{
    const alice=await session()
    const original=input()
    await recordLocalNotification(original)
    expect(await recordLocalNotification(original)).toMatchObject({id:eventId})
    expect(await rows()).toHaveLength(1)
    expect((await markNotificationRead(eventId,1_760_000_000_000))?.readAt)
      .toBe(1_760_000_000_000)
    expect(await localUnreadCount()).toBe(0)
    const reboot={...alice,online:true}
    activeSession.value=reboot
    expect(await recordLocalNotification(original)).toHaveProperty('readAt',1_760_000_000_000)
    expect((await listLocalNotifications())[0]!.readAt).toBe(1_760_000_000_000)
    await expect(recordLocalNotification({...original,kind:'team-invite'}))
      .rejects.toThrow('notifications.duplicate_conflict')
    expect((await listLocalNotifications())[0]!.kind).toBe('assignment-invite')
  })
  it('keeps unrelated accounts apart and fails closed after AKEK rotation',async()=>{
    const alice=await session()
    await recordLocalNotification(input())
    await session(crypto.randomUUID())
    expect(await listLocalNotifications()).toEqual([])
    const changed=await session(alice.accountId)
    await expect(listLocalNotifications())
      .rejects.toThrow('notifications.encrypted_record_unreadable')
    expect(changed.pkg.akek).not.toBe(alice.pkg.akek)
    activeSession.value=alice
    expect(await localUnreadCount()).toBe(1)
  })
  it('marks a bounded snapshot as read and does not mark a missing event',async()=>{
    await session()
    await recordLocalNotification(input())
    const second='66666666-6666-4666-8666-666666666666'
    await recordLocalNotification({...input(second),kind:'file-expiry'})
    expect(await markNotificationRead('77777777-7777-4777-8777-777777777777')).toBeNull()
    expect(await markAllLocalNotificationsRead()).toBe(2)
    expect(await markAllLocalNotificationsRead()).toBe(0)
    expect(await listLocalNotifications({unreadOnly:true})).toEqual([])
    expect(await localUnreadCount()).toBe(0)
    expect(await listLocalNotifications()).toHaveLength(2)
  })
  it('encrypts non-clickable retention deadline notice without old media target',async()=>{
    await session()
    const event={id:eventId,kind:'file-expiry' as const,
      targetId:null,occurredAt:1_750_000_000_000}
    await recordLocalNotification(event)
    expect((await listLocalNotifications())[0]).toMatchObject(event)
    expect((await rows())[0]).toBeDefined()
    expect(JSON.stringify(await rows())).not.toContain(eventId)
    const preview=previewNotification((await listLocalNotifications())[0]!)
    expect(preview.title).toBe('Удаление файла')
    expect(preview.description).toBe('Проверьте срок хранения файла.')
  })
  it('resolves concurrent marking and event dedup without losing read state',async()=>{
    await session()
    const row=input()
    await Promise.all([recordLocalNotification(row),recordLocalNotification(row)])
    await Promise.all([markNotificationRead(eventId),markNotificationRead(eventId)])
    expect(await localUnreadCount()).toBe(0)
    expect((await listLocalNotifications())[0]!.readAt).not.toBeNull()
    expect(await rows()).toHaveLength(1)
  })
  it('refuses forged payload fields, improper target and other invalid values',async()=>{
    await session()
    await expect(recordLocalNotification({...input(),title:'PRIVATE CAPTION'} as unknown as LocalNotificationInput))
      .rejects.toThrow('notifications.invalid_event')
    await expect(recordLocalNotification({...input(),id:'not-a-uuid'}))
      .rejects.toThrow('notifications.invalid_event')
    await expect(recordLocalNotification({...input(),targetId:null}))
      .rejects.toThrow('notifications.invalid_event')
    await expect(recordLocalNotification({...input(),kind:'security'}))
      .rejects.toThrow('notifications.invalid_event')
    await expect(recordLocalNotification({...input(),occurredAt:Number.POSITIVE_INFINITY}))
      .rejects.toThrow('notifications.invalid_event')
    expect(await rows()).toHaveLength(0)
  })
  it('rejects corruption and row-key substitution rather than showing wrong target',async()=>{
    await session()
    await recordLocalNotification(input())
    const raw=new Dexie('pb3-encrypted-notifications-v1')
    raw.version(1).stores({rows:'&key,ownerScope'})
    const row=(await rows())[0]!
    await raw.table('rows').put({...row,iv:b64(random(12))})
    await expect(listLocalNotifications())
      .rejects.toThrow('notifications.encrypted_record_unreadable')
    await raw.table('rows').put({...row,key:'f'.repeat(64)})
    await expect(listLocalNotifications())
      .rejects.toThrow('notifications.encrypted_record_unreadable')
    await raw.table('rows').delete('f'.repeat(64))
    await raw.table('rows').put(row)
    expect(await localUnreadCount()).toBe(1)
    raw.close()
  })
})
