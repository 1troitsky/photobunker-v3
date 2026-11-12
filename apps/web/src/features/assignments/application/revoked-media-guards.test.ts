import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it} from 'vitest'
import {freshPackage} from '../../identity/infrastructure/crypto'
import {activeSession,type Session} from '../../identity/application/session'
import {
  queueAssignmentCreation,listAssignmentOperations,
  signedMediaCaptureIntent,queueAssignmentMediaSubmission,
  assertNoVerifiedAssignmentRemoval,
} from './assignment-outbox'
import {preflightAssignmentMediaGrant} from './media-submission-preflight'

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
const contributor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'
const assignment='cccccccc-cccc-4ccc-8ccc-cccccccccccd'

async function account(id:string):Promise<void>{
  const {pkg}=await freshPackage(id)
  activeSession.value={
    accountId:id,deviceId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pkg,online:false,
  } as unknown as Session
}
async function seedVerifiedRemoval(accountId:string,assignmentId:string):Promise<void>{
  // The production writer reaches this store only AFTER validating the
  // owner's signed removal. This test exercises the durable denial boundary.
  await listAssignmentOperations() // opens/upgrades Dexie to version 4
  const d=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('pb3-assignment-operation-outbox-v1')
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=d.transaction('revocations','readwrite')
      tx.objectStore('revocations').put({
        key:accountId+'/'+assignmentId,accountId,assignmentId,
        ownerAccountId:owner,inviteId:crypto.randomUUID(),
        removalContract:'owner-signed-removal-verified-upstream',
        removalSignature:'upstream-verified-signature',
        verifiedAt:Date.now(),
      })
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error)
    })
  }finally{d.close()}
}

afterEach(()=>{activeSession.value=null})

describe('P2 V-31 verified owner removal blocks new AV capture and media E2EE grants',()=>{
  it('rejects revoked photo/video/audio Fieldwork operations offline before stale policy access',async()=>{
    await account(contributor)
    const personal=await queueAssignmentCreation({
      title:'Independent personal owner record',
      instructions:'Never expose this plaintext',photoGoal:3,
    })
    const before=await listAssignmentOperations()
    expect(before.some(x=>x.kind==='create'
      &&x.contract.includes(personal))).toBe(true)
    await seedVerifiedRemoval(contributor,assignment)
    await expect(assertNoVerifiedAssignmentRemoval(assignment))
      .rejects.toThrow('assignment.member_removed')
    for(const kind of ['video','audio'] as const){
      await expect(signedMediaCaptureIntent(assignment,kind))
        .rejects.toThrow('assignment.member_removed')
    }
    await expect(queueAssignmentMediaSubmission(
      assignment,crypto.randomUUID(),crypto.randomUUID(),
    )).rejects.toThrow('assignment.member_removed')
    // No online policy read or E2EE grant should occur for an already
    // authenticated local denial even when the session is offline.
    await expect(preflightAssignmentMediaGrant(
      assignment,crypto.randomUUID(),owner,
    )).rejects.toThrow('assignment.member_removed')
    expect(await listAssignmentOperations()).toEqual(before)
  })
  it('scopes tombstones to the precise account and assignment, never a global ban',async()=>{
    await account(contributor)
    await seedVerifiedRemoval(contributor,assignment)
    await expect(assertNoVerifiedAssignmentRemoval(crypto.randomUUID()))
      .resolves.toBeUndefined()
    await account(owner)
    await expect(assertNoVerifiedAssignmentRemoval(assignment))
      .resolves.toBeUndefined()
    // Without a cached signed policy the other account still fails closed
    // for a different reason, not because of someone else's tombstone.
    await expect(signedMediaCaptureIntent(assignment,'video'))
      .rejects.toThrow('assignment.policy_not_cached')
    await expect(queueAssignmentMediaSubmission(
      assignment,crypto.randomUUID(),crypto.randomUUID(),
    )).rejects.toThrow('assignment.policy_not_cached')
  })
})
