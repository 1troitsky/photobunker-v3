import 'fake-indexeddb/auto'
import {afterEach,describe,expect,it} from 'vitest'
import {freshPackage,digest,hex} from '../../identity/infrastructure/crypto'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {
  assertSignedPolicyProgress,assignmentFilesOpenAt,assignmentGrantExpiryCap,
  listAssignmentOperations,queueAssignmentCreation,queueAssignmentRetentionChange,
  signedAssignmentRetention,verifySignedAssignmentPolicy,
} from './assignment-outbox'
import type {AssignmentListing,AssignmentRetention} from './assignment-outbox'

afterEach(()=>{activeSession.value=null})

describe('P1-21 owner-signed durable assignment retention',()=>{
  it('queues only an immutable-root-bound operation and rejects forged, stale and unsafe revisions',async()=>{
    const owner=crypto.randomUUID()
    const {pkg}=await freshPackage(owner)
    activeSession.value={
      accountId:owner,
      deviceId:crypto.randomUUID(),
      pkg,online:false,
    } as Session
    const id=await queueAssignmentCreation({
      title:'PRIVATE RETENTION TITLE',
      instructions:'SENSITIVE FIELDWORK INSTRUCTIONS',
      photoGoal:30,
    })
    const create=(await listAssignmentOperations()).find(op=>op.kind==='create'
      &&(JSON.parse(op.contract) as {assignmentId?:string}).assignmentId===id)!
    const root=JSON.parse(create.contract) as {
      startsAt:number;endsAt:null
      privateEnvelope:AssignmentListing['privateEnvelope']
    }
    const row:AssignmentListing={
      assignmentId:id,ownerAccountId:owner,ownerAccountSpki:pkg.accountSpki,
      state:'active',revision:1,policyRevision:1,privateRevision:1,
      retentionRevision:1,
      policyContract:create.contract,policySignature:create.signature,
      privateEnvelope:root.privateEnvelope,
      stateContract:null,stateSignature:null,
      startsAt:root.startsAt,endsAt:root.endsAt,
      photoGoal:30,confirmedPhotoCount:0,
    }
    await verifySignedAssignmentPolicy(row,true)
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('pb3-assignment-operation-outbox-v1')
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>reject(request.error)
    })
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('capturePolicies','readwrite')
      tx.objectStore('capturePolicies').put({
        key:owner+'/'+id,accountId:owner,listing:row,verifiedAt:Date.now(),
      })
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error)
    })
    db.close()

    const files=Date.now()+3*86400000
    const assignment=files+86400000
    const next:AssignmentRetention={
      filesAccessUntil:files,assignmentAccessUntil:assignment,
      deleteOriginals:false,
    }
    const opId=await queueAssignmentRetentionChange(id,next)
    const op=(await listAssignmentOperations()).find(item=>item.id===opId)!
    expect(op.kind).toBe('retention')
    expect(op.state).toBe('queued')
    expect(op.path).toBe('/assignments/v1/'+id+'/retention')
    expect(op.contract).not.toContain('PRIVATE RETENTION TITLE')
    expect(op.contract).not.toContain('SENSITIVE FIELDWORK INSTRUCTIONS')
    const signed=JSON.parse(op.contract) as Record<string,unknown>
    expect(signed.rootPolicyHash)
      .toBe(hex(await digest(new TextEncoder().encode(create.contract))))
    expect(signed.previousRetentionHash).toBe(signed.rootPolicyHash)
    expect(signed.fromRetentionRevision).toBe(1)
    expect(signed.toRetentionRevision).toBe(2)
    expect(signed.deleteOriginals).toBe(false)

    const changed:AssignmentListing={
      ...row,retentionRevision:2,
      retentionAmendmentContract:op.contract,
      retentionAmendmentSignature:op.signature,
      filesAccessUntil:files,assignmentAccessUntil:assignment,
    }
    await expect(verifySignedAssignmentPolicy(changed,true)).resolves.toBeUndefined()
    expect(signedAssignmentRetention(changed)).toEqual(next)
    // New contributor-signed assignment-only grants must not outlive the
    // earliest owner-signed access cutoff (independent v1 shares unchanged).
    expect(assignmentGrantExpiryCap(row)).toBeNull()
    expect(assignmentGrantExpiryCap(changed)).toBe(files)
    expect(assignmentFilesOpenAt(changed,files)).toBe(false)
    expect(()=>assertSignedPolicyProgress(row,changed)).not.toThrow()
    expect(()=>assertSignedPolicyProgress(changed,row))
      .toThrow('assignment.retention_rollback')
    expect(()=>assertSignedPolicyProgress(changed,{
      ...changed,assignmentAccessUntil:assignment+1000,
    })).toThrow('assignment.retention_equivocation')
    await expect(verifySignedAssignmentPolicy({
      ...changed,retentionAmendmentSignature:create.signature,
    },true)).rejects.toThrow('assignment.retention_not_authenticated')
    await expect(verifySignedAssignmentPolicy({
      ...changed,filesAccessUntil:files+86400000,
    },true)).rejects.toThrow('assignment.retention_projection_mismatch')
    await expect(queueAssignmentRetentionChange(id,next))
      .rejects.toThrow('assignment.retention_edit_pending')
    await expect(queueAssignmentRetentionChange(id,{
      ...next,deleteOriginals:true,
    } as unknown as AssignmentRetention))
      .rejects.toThrow('assignment.invalid_retention')
  })
})
