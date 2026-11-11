import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {freshPackage,sign} from '../../identity/infrastructure/crypto'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {pinnedPeer} from '../../sharing/key-directory'
import type {SignedDirectory} from '../../sharing/key-directory'
import type {AssignmentRemovalNotice} from './verify-removal-notice'
import {
  listAssignmentRemovalNotices,listCachedAssignmentInvites,signedCaptureBinding,
  cachePrivateAssignment,readCachedPrivateAssignment,
} from './assignment-outbox'

vi.mock('../../identity/infrastructure/api',()=>({jsonApi:vi.fn()}))
vi.mock('../../sharing/key-directory',()=>({pinnedPeer:vi.fn()}))

const id=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0')
afterEach(()=>{
  activeSession.value=null
  vi.mocked(jsonApi).mockReset()
  vi.mocked(pinnedPeer).mockReset()
  vi.unstubAllGlobals()
})

async function localDb():Promise<IDBDatabase>{
  await listCachedAssignmentInvites() // initializes the actual Dexie v4 schema
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('pb3-assignment-operation-outbox-v1')
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}
async function seed(recipientId:string,ownerId:string,assignmentId:string,inviteId:string){
  const db=await localDb()
  const key=recipientId+'/'+assignmentId
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(['invites','capturePolicies','privateSummaries','operations'],
      'readwrite')
    tx.objectStore('invites').put({
      inviteId,assignmentId,ownerAccountId:ownerId,
      cachedForAccountId:recipientId,state:'accepted',
    })
    tx.objectStore('capturePolicies').put({
      key,accountId:recipientId,verifiedAt:Date.now(),
      listing:{assignmentId,ownerAccountId:ownerId},
    })
    tx.objectStore('privateSummaries').put({
      key,accountId:recipientId,assignmentId,policyHash:'a'.repeat(64),
      iv:'ciphertext-iv',ciphertext:new Blob(['encrypted-cache-only']),
    })
    tx.objectStore('operations').put({
      id:id(900),accountId:recipientId,kind:'submit',
      state:'queued',createdAt:1,
    })
    tx.oncomplete=()=>resolve()
    tx.onerror=()=>reject(tx.error)
  })
  db.close()
}
async function stored(recipientId:string,assignmentId:string,inviteId:string){
  const db=await localDb(),key=recipientId+'/'+assignmentId
  const result=await new Promise<Record<string,boolean>>((resolve,reject)=>{
    const tx=db.transaction(['invites','capturePolicies','privateSummaries','operations','revocations'],
      'readonly')
    const ids=[
      ['invites',inviteId],
      ['capturePolicies',key],['privateSummaries',key],
      ['operations',id(900)],['revocations',key],
    ] as const
    const requests=ids.map(([store,k])=>tx.objectStore(store).get(k))
    tx.oncomplete=()=>resolve(Object.fromEntries(
      ids.map(([store],i)=>[store,!!requests[i]!.result])))
    tx.onerror=()=>reject(tx.error)
  })
  db.close()
  return result
}
async function scenario(n:number){
  // The authenticated response is supplied by the test transport mock.
  // Set explicit online state: Vitest's Node navigator defaults to offline.
  vi.stubGlobal('navigator',{onLine:true})
  const recipientId=id(100+n*10),ownerId=id(101+n*10)
  const assignmentId=id(102+n*10),inviteId=id(103+n*10)
  const own=await freshPackage(recipientId)
  const owner=await freshPackage(ownerId)
  activeSession.value={
    accountId:recipientId,deviceId:id(200+n),online:true,pkg:own.pkg,
  } as unknown as Session
  const invitationContract=JSON.stringify({
    version:1,inviteId,assignmentId,ownerAccountId:ownerId,
    recipientAccountId:recipientId,recipientKeyDigest:'a'.repeat(64),
    role:'contributor',expiresAt:1800000000000,
    envelope:{ephemeralSpki:owner.pkg.accountSpki,
      salt:'test-salt',iv:'test-iv',ciphertext:'not-real-encrypted-bytes'},
  })
  const removalContract=JSON.stringify({
    version:1,action:'remove',operationId:id(104+n*10),
    assignmentId,inviteId,ownerAccountId:ownerId,
    recipientAccountId:recipientId,
  })
  const notice:AssignmentRemovalNotice={
    inviteId,assignmentId,ownerAccountId:ownerId,recipientAccountId:recipientId,
    ownerAccountSpki:owner.pkg.accountSpki,invitationContract,
    invitationSignature:await sign(owner.signer,
      'pb3.assignment-invite.v1\n'+invitationContract),
    removalContract,removalSignature:await sign(owner.signer,
      'pb3.assignment-member-remove.v1\n'+removalContract),
  }
  await seed(recipientId,ownerId,assignmentId,inviteId)
  vi.mocked(jsonApi).mockResolvedValue({items:[notice],nextCursor:null})
  vi.mocked(pinnedPeer).mockResolvedValue({
    accountId:ownerId,accountSpki:owner.pkg.accountSpki,
  } as SignedDirectory)
  return {recipientId,assignmentId,inviteId,notice}
}
describe('V-27 owner-signed revocation fences local capture authority',()=>{
  it('atomically invalidates only revoked Fieldwork cache, keeps pending media outbox',async()=>{
    const ctx=await scenario(1)
    const result=await listAssignmentRemovalNotices()
    expect(result[0]?.verified).toBe(true)
    expect(await stored(ctx.recipientId,ctx.assignmentId,ctx.inviteId)).toEqual({
      invites:false,capturePolicies:false,privateSummaries:false,
      operations:true,revocations:true,
    })
    await expect(signedCaptureBinding(ctx.assignmentId))
      .rejects.toThrow('assignment.member_removed')
    const privateSummary={
      version:1 as const,title:'Formerly authorized private assignment',
      instructions:'Contributor-only confidential instructions',
    }
    await expect(cachePrivateAssignment(ctx.assignmentId,'signed-policy',privateSummary))
      .rejects.toThrow('assignment.member_removed')
    await expect(readCachedPrivateAssignment(ctx.assignmentId,'signed-policy'))
      .rejects.toThrow('assignment.member_removed')
    expect(await listCachedAssignmentInvites()).toEqual([])
    // Simulate stale async code resurrecting the old encrypted summary.
    // The read barrier must reject it before AES-GCM decryption.
    const db=await localDb(),key=ctx.recipientId+'/'+ctx.assignmentId
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('privateSummaries','readwrite')
      tx.objectStore('privateSummaries').put({
        key,accountId:ctx.recipientId,assignmentId:ctx.assignmentId,
        policyHash:'a'.repeat(64),iv:'stale-iv',
        ciphertext:new Blob(['stale-ciphertext']),
      })
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error)
    })
    db.close()
    await expect(readCachedPrivateAssignment(ctx.assignmentId,'signed-policy'))
      .rejects.toThrow('assignment.member_removed')
    expect((await stored(ctx.recipientId,ctx.assignmentId,ctx.inviteId)).operations)
      .toBe(true)
  })
  it('a missing independently pinned owner cannot remove cached local rights',async()=>{
    const ctx=await scenario(2)
    vi.mocked(pinnedPeer).mockRejectedValueOnce(
      new Error('share.peer_not_confirmed'))
    const result=await listAssignmentRemovalNotices()
    expect(result[0]?.verified).toBe(false)
    expect(await stored(ctx.recipientId,ctx.assignmentId,ctx.inviteId)).toEqual({
      invites:true,capturePolicies:true,privateSummaries:true,
      operations:true,revocations:false,
    })
  })
  it('unverified owner notice does not prevent legitimate encrypted summary cache',async()=>{
    const ctx=await scenario(4)
    vi.mocked(pinnedPeer).mockRejectedValueOnce(
      new Error('share.peer_not_confirmed'))
    const result=await listAssignmentRemovalNotices()
    expect(result[0]?.verified).toBe(false)
    const secret={
      version:1 as const,title:'Still locally permitted',
      instructions:'No verified owner revocation',
    }
    await expect(cachePrivateAssignment(ctx.assignmentId,'policy',secret))
      .resolves.toBeUndefined()
    await expect(readCachedPrivateAssignment(ctx.assignmentId,'policy'))
      .resolves.toEqual(secret)
    expect((await stored(ctx.recipientId,ctx.assignmentId,ctx.inviteId)).revocations)
      .toBe(false)
  })
  it('forged owner signature never purges the private summary or outbox',async()=>{
    const ctx=await scenario(3)
    vi.mocked(jsonApi).mockResolvedValue({
      items:[{...ctx.notice,removalSignature:ctx.notice.invitationSignature}],
      nextCursor:null,
    })
    const result=await listAssignmentRemovalNotices()
    expect(result[0]?.verified).toBe(false)
    expect(await stored(ctx.recipientId,ctx.assignmentId,ctx.inviteId)).toEqual({
      invites:true,capturePolicies:true,privateSummaries:true,
      operations:true,revocations:false,
    })
  })
})
