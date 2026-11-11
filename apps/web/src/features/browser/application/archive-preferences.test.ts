import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,importSpki,verify} from '../../identity/infrastructure/crypto'
import {
  localArchivePreferences,editArchivePreferences,
  effectiveArchivePreferenceValues,synchronizeArchivePreferences,
  discardArchivePreferenceDraft,
} from './archive-preferences'

const {api}=vi.hoisted(()=>({api:vi.fn()}))
vi.mock('../../identity/infrastructure/api',()=>({jsonApi:api}))
afterEach(()=>{activeSession.value=null;api.mockReset()})
async function identity():Promise<Session>{
  const accountId=crypto.randomUUID(),deviceId=crypto.randomUUID()
  const {pkg}=await freshPackage(accountId)
  const encryptionKey=await crypto.subtle.generateKey({
    name:'AES-GCM',length:256,
  },false,['encrypt','decrypt'])
  const s={accountId,deviceId,pkg,online:true,
    device:{encryptionKey}} as Session
  activeSession.value=s
  return s
}
async function indexedRows():Promise<string>{
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('pb3-browser-archive-preferences-v1')
    req.onerror=()=>reject(req.error)
    req.onsuccess=()=>{
      const db=req.result
      const r=db.transaction('rows','readonly').objectStore('rows').getAll()
      r.onsuccess=()=>{db.close();resolve(JSON.stringify(r.result))}
      r.onerror=()=>{db.close();reject(r.error)}
    }
  })
}
describe('owner archive preferences, Local-First + signed CAS',()=>{
  it('default true, encrypted local edit, server signed ACK and same-device restore',async()=>{
    const s=await identity()
    let revision=0,stored={useArchive:true,autoDeleteAfter7Days:true}
    const operations:string[]=[]
    api.mockImplementation(async(_path:string,method?:string,body?:{
      contract:string;signature:string,
    })=>{
      expect(path).toBe('/browser/v1/archive/preferences')
      if(method!=='POST')
        return {...stored,revision,writeEnabled:false,autoCleanupEnabled:false}
      const c=JSON.parse(body!.contract) as {
        accountId:string;writerDeviceId:string;expectedRevision:number
        useArchive:boolean;autoDeleteAfter7Days:boolean;operationId:string
      }
      expect(c.accountId).toBe(s.accountId)
      expect(c.writerDeviceId).toBe(s.deviceId)
      expect(await verify(await importSpki(s.pkg.accountSpki),
        'pb3.browser-archive-preferences.v1\n'+body!.contract,
        body!.signature)).toBe(true)
      operations.push(c.operationId)
      expect(c.expectedRevision).toBe(revision)
      revision++
      stored={useArchive:c.useArchive,autoDeleteAfter7Days:c.autoDeleteAfter7Days}
      return {...stored,revision,unchanged:false}
    })
    expect(effectiveArchivePreferenceValues(await localArchivePreferences()))
      .toEqual({useArchive:true,autoDeleteAfter7Days:true})
    await synchronizeArchivePreferences()
    const local=await editArchivePreferences({
      useArchive:false,autoDeleteAfter7Days:false,
    })
    expect(local.draft).toEqual({useArchive:false,autoDeleteAfter7Days:false})
    const raw=await indexedRows()
    expect(raw).not.toContain('useArchive')
    expect(raw).not.toContain('autoDeleteAfter7Days')
    expect(raw).not.toContain(s.accountId.slice(0,16)+'\":') // no plaintext JSON
    const result=await synchronizeArchivePreferences()
    expect(result.state).toBe('uploaded')
    expect(result.data.confirmed).toMatchObject({
      useArchive:false,autoDeleteAfter7Days:false,revision:1,
      writeEnabled:false,autoCleanupEnabled:false,
    })
    expect(result.data.draft).toBeNull()
    expect(result.data.pending).toBeNull()
    activeSession.value=null;activeSession.value=s
    expect((await localArchivePreferences()).confirmed?.revision).toBe(1)
    expect(operations).toHaveLength(1)
  })
  it('keeps identical signed payload after Lost ACK and does not overwrite pending',async()=>{
    const s=await identity()
    let revision=0,lastCommand='',lastSignature=''
    api.mockImplementation(async(path:string,method?:string,body?:{
      contract:string;signature:string,
    })=>{
      if(method!=='POST')return {
        useArchive:revision===0,useArchiveOverridden:undefined,
        autoDeleteAfter7Days:true,revision,
        writeEnabled:true,autoCleanupEnabled:false,
      }
      if(!lastCommand){
        lastCommand=body!.contract;lastSignature=body!.signature
        revision=1
        throw Error('network-lost-ack')
      }
      expect(body!.contract).toBe(lastCommand)
      expect(body!.signature).toBe(lastSignature)
      return {useArchive:false,autoDeleteAfter7Days:true,
        revision:1,unchanged:true}
    })
    await synchronizeArchivePreferences()
    await editArchivePreferences({useArchive:false})
    await expect(synchronizeArchivePreferences()).rejects.toThrow('network-lost-ack')
    const pending=(await localArchivePreferences()).pending
    expect(pending?.operationId).toBeTruthy()
    await expect(editArchivePreferences({autoDeleteAfter7Days:false}))
      .rejects.toThrow('browser.preferences_pending_upload')
    const raw=await indexedRows()
    expect(raw).not.toContain(lastCommand)
    activeSession.value=null;activeSession.value=s
    expect((await localArchivePreferences()).pending?.operationId)
      .toBe(pending?.operationId)
    expect((await synchronizeArchivePreferences()).state).toBe('uploaded')
    expect((await localArchivePreferences()).pending).toBeNull()
  })
  it('never overwrites another device revision with a local draft',async()=>{
    await identity()
    let revision=1
    api.mockImplementation(async()=>{
      return {useArchive:true,autoDeleteAfter7Days:true,revision,
        writeEnabled:true,autoCleanupEnabled:false}
    })
    await synchronizeArchivePreferences()
    await editArchivePreferences({autoDeleteAfter7Days:false})
    revision=2
    const result=await synchronizeArchivePreferences()
    expect(result.state).toBe('conflict')
    expect((await localArchivePreferences()).draft?.autoDeleteAfter7Days).toBe(false)
    expect(api).toHaveBeenCalledTimes(2)
    const accepted=await discardArchivePreferenceDraft()
    expect(accepted.confirmed?.revision).toBe(2)
    expect(accepted.draft).toBeNull()
  })
  it('never exposes previous account preferences or allows cross-account decrypt',async()=>{
    const s=await identity()
    await editArchivePreferences({useArchive:false})
    await identity()
    expect((await localArchivePreferences()).draft).toBeNull()
    activeSession.value=s
    expect((await localArchivePreferences()).draft?.useArchive).toBe(false)
  })
})
