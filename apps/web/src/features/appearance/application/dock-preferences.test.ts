import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {
  appliedDock,previewDock,DEFAULT_DOCK,validateDock,
  saveDock,loadDock,
} from './dock-preferences'

let owner:Session
async function rows():Promise<Array<Record<string,unknown>>>{
  const db=new Dexie('pb3-encrypted-appearance-dock-v1')
  db.version(1).stores({prefs:'&scope'})
  const result=await db.table('prefs').toArray() as Array<Record<string,unknown>>
  db.close()
  return result
}
beforeEach(async()=>{
  // Each Vitest case must not mutate a prior case's encrypted owner row.
  // Without clearing, rows()[0] can belong to a different random account.
  const isolated=new Dexie('pb3-encrypted-appearance-dock-v1')
  isolated.version(1).stores({prefs:'&scope'})
  await isolated.table('prefs').clear()
  isolated.close()
  const accountId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  owner={
    accountId,deviceId:crypto.randomUUID(),pkg,online:false,
  } as Session
  activeSession.value=owner
  await loadDock()
})
afterEach(()=>{
  activeSession.value=null
  previewDock.value=null
})
describe('P2 accepted Dock 3-6, mandatory Settings and account encryption',()=>{
  it('enforces all non-negotiable accepted Dock invariants',()=>{
    expect(DEFAULT_DOCK).toEqual([
      'assignments','browser','camera','contacts','settings',
    ])
    expect(validateDock(['settings','messages','camera'])).toHaveLength(3)
    expect(()=>validateDock(['messages','camera'])).toThrow('appearance.dock_count')
    expect(()=>validateDock(['messages','camera','browser'])).toThrow('appearance.dock_settings_required')
    expect(()=>validateDock(['settings','camera','camera'])).toThrow('appearance.dock_duplicate')
    expect(()=>validateDock(['settings','camera','notifications'])).toThrow('appearance.dock_unknown')
    expect(()=>validateDock(['settings','camera','messages','browser','contacts','assignments','settings']))
      .toThrow('appearance.dock_count')
  })
  it('persists validated selections offline as AKEK-derived AES-GCM ciphertext',async()=>{
    const selected=['settings','messages','browser'] as const
    await saveDock(selected)
    expect(appliedDock.value).toEqual(selected)
    const all=await rows()
    const persisted=JSON.stringify(all)
    expect(persisted).not.toContain(owner.accountId)
    expect(persisted).not.toContain('messages')
    expect(persisted).not.toContain('settings')
    expect(persisted).not.toContain('dock')
    expect(all).toHaveLength(1)
    expect(all[0]).toHaveProperty('iv')
    expect(all[0]).toHaveProperty('ciphertext')
    appliedDock.value=[...DEFAULT_DOCK]
    await loadDock()
    expect(appliedDock.value).toEqual(selected)
    expect(owner.online).toBe(false)
  })
  it('prevents account B seeing A and restores A without browser network',async()=>{
    const selected=['settings','contacts','messages'] as const
    await saveDock(selected)
    const accountId=crypto.randomUUID(),{pkg}=await freshPackage(accountId)
    activeSession.value={
      accountId,deviceId:crypto.randomUUID(),pkg,online:false,
    } as Session
    await loadDock()
    expect(appliedDock.value).toEqual(DEFAULT_DOCK)
    await saveDock(['settings','camera','browser'])
    activeSession.value=owner
    await loadDock()
    expect(appliedDock.value).toEqual(selected)
    expect(await rows()).toHaveLength(2)
  })
  it('rejects tampered ciphertext without rendering untrusted preferences',async()=>{
    await saveDock(['settings','browser','camera'])
    const all=await rows()
    const database=new Dexie('pb3-encrypted-appearance-dock-v1')
    database.version(1).stores({prefs:'&scope'})
    await database.table('prefs').update(all[0]!.scope as string,{
      ciphertext:'tampered-base64',
    })
    database.close()
    await expect(loadDock()).rejects.toThrow('appearance.decrypt_failed')
    expect(appliedDock.value).toEqual(DEFAULT_DOCK)
  })
  it('failed validation does not modify persisted encrypted preferences',async()=>{
    await saveDock(['settings','messages','contacts'])
    const before=JSON.stringify(await rows())
    await expect(saveDock(['settings','camera','camera']))
      .rejects.toThrow('appearance.dock_duplicate')
    expect(JSON.stringify(await rows())).toBe(before)
    expect(appliedDock.value).toEqual(['settings','messages','contacts'])
  })
})
