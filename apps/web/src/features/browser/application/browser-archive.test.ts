import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {freshPackage,importSpki,verify} from '../../identity/infrastructure/crypto'
import {signedArchiveAction,getPendingArchiveAction} from './browser-archive'
import type {ArchiveEntry} from './browser-archive'

const {post}=vi.hoisted(()=>({post:vi.fn()}))
vi.mock('../../identity/infrastructure/api',()=>({jsonApi:post}))
afterEach(()=>{activeSession.value=null;post.mockReset()})

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
describe('signed archive action sends precise protocol bytes',()=>{
  it('signs the real domain newline and clears outbox only after matching ACK',async()=>{
    const s=await identity(),assetId=crypto.randomUUID()
    const entry:ArchiveEntry={
      entryId:crypto.randomUUID(),kind:'media',assetId,
      revision:1,state:'archived',archiveUntilMs:Date.now()+100000,
      expiresAt:Date.now()+100000,mediaType:'audio',plainBytes:1000,
      physicalStatus:'not_started',
    }
    let confirmed=false
    post.mockImplementation(async(path:string,method:string,body:{
      command:string;signature:string,
    })=>{
      expect(path).toBe('/browser/v1/archive/actions')
      expect(method).toBe('POST')
      const parsed=JSON.parse(body.command) as {
        accountId:string;writerDeviceId:string;assetId:string;
        action:string;expectedRevision:number;operationId:string
      }
      expect(parsed).toMatchObject({
        accountId:s.accountId,writerDeviceId:s.deviceId,
        assetId,action:'restore',expectedRevision:1,
      })
      confirmed=await verify(await importSpki(s.pkg.accountSpki),
        'pb3.browser-archive.v1\n'+body.command,body.signature)
      return {entryId:entry.entryId,kind:'media',assetId,
        state:'restored',revision:2,archiveUntilMs:null,
        expiresAt:entry.expiresAt,physicalStatus:'not_started',
        unchanged:false}
    })
    const result=await signedArchiveAction(entry,'restore')
    expect(confirmed).toBe(true)
    expect(result.revision).toBe(2)
    expect(await getPendingArchiveAction()).toBeNull()
  })
})
