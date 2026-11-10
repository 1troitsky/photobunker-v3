import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { freshPackage, importSigner, sign, digest, hex } from '../../identity/infrastructure/crypto'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import {
  queueAssignmentCreation, listLocalAssignmentDrafts, listAssignmentOperations,
  verifySignedAssignmentPolicy, assertSignedPolicyProgress,
  cachePrivateAssignment, readCachedPrivateAssignment,
  signedCaptureBinding,signedPolicyRequirements,queueAssignmentGoalChange,
} from './assignment-outbox'

afterEach(()=>{activeSession.value=null})

async function account(id:string):Promise<void>{
  const {pkg}=await freshPackage(id)
  activeSession.value={
    accountId:id,deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    pkg,online:false,
  } as unknown as Session
}

describe('P1-04 assignment Local-First encrypted operation outbox',()=>{
  it('stores only signed ciphertext before any HTTP acknowledgement',async()=>{
    await account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const id=await queueAssignmentCreation({
      title:'Confidential Assignment',
      instructions:'Capture 30 photographs, never publish the location',
      photoGoal:30,
    })
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    const [local]=await listLocalAssignmentDrafts()
    expect(local.state).toBe('queued')
    expect(local.photoGoal).toBe(30)
    expect(JSON.stringify(local)).not.toContain('Confidential')
    const [operation]=await listAssignmentOperations()
    expect(operation.kind).toBe('create')
    expect(operation.state).toBe('queued')
    expect(operation.signature.length).toBeGreaterThan(50)
    expect(operation.contract).not.toContain('Confidential')
    expect(operation.contract).not.toContain('never publish')
    const contract=JSON.parse(operation.contract)
    expect(contract.assignmentId).toBe(id)
    expect(contract.privateEnvelope.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it('authenticates owner-signed capture policy before trusting server flags',async()=>{
    const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    await account(id)
    const current=activeSession.value
    expect(current).not.toBeNull()
    await queueAssignmentCreation({
      title:'Verified offline capture',
      instructions:'Private details are encrypted',
      photoGoal:30,
    })
    const [op]=await listAssignmentOperations()
    const c=JSON.parse(op.contract)
    const listing={
      assignmentId:c.assignmentId,ownerAccountId:id,
      ownerAccountSpki:current!.pkg.accountSpki,
      state:c.state,revision:c.revision,photoGoal:c.photoGoal,
      confirmedPhotoCount:0,policyRevision:c.policyRevision,
      startsAt:c.startsAt,endsAt:c.endsAt,
      privateEnvelope:c.privateEnvelope,
      policyContract:op.contract,policySignature:op.signature,
      stateContract:null,stateSignature:null,
    }
    await expect(verifySignedAssignmentPolicy(listing)).resolves.toBeUndefined()
    await expect(verifySignedAssignmentPolicy({...listing,photoGoal:31}))
      .rejects.toThrow('assignment.policy_snapshot_mismatch')
    await expect(verifySignedAssignmentPolicy({...listing,confirmedPhotoCount:-1}))
      .rejects.toThrow('assignment.invalid_receipt_count')
    await expect(verifySignedAssignmentPolicy({...listing,confirmedPhotoCount:1.25}))
      .rejects.toThrow('assignment.invalid_receipt_count')
    await expect(verifySignedAssignmentPolicy({...listing,policyContract:op.contract.replace(
      '"photoGoal":30','"photoGoal":31')}))
      .rejects.toThrow('assignment.untrusted_capture_policy')
    await expect(verifySignedAssignmentPolicy({...listing,
      ownerAccountSpki:'unexpected-key'}))
      .rejects.toThrow('assignment.untrusted_capture_policy')
    const state={
      version:1,operationId:crypto.randomUUID(),
      assignmentId:c.assignmentId,ownerAccountId:id,
      policyHash:hex(await digest(new TextEncoder().encode(op.contract))),
      policyRevision:1,fromRevision:1,toRevision:2,
      action:'finish',state:'finished',
    }
    const stateContract=JSON.stringify(state)
    const stateSignature=await sign(await importSigner(current!.pkg.accountPkcs8),
      'pb3.assignment-state.v1\n'+stateContract)
    const finished={...listing,state:'finished',revision:2,
      stateContract,stateSignature}
    await expect(verifySignedAssignmentPolicy(finished)).resolves.toBeUndefined()
    await expect(verifySignedAssignmentPolicy({...finished,state:'active'}))
      .rejects.toThrow('assignment.state_snapshot_mismatch')
    await expect(verifySignedAssignmentPolicy({...finished,revision:3}))
      .rejects.toThrow('assignment.state_snapshot_mismatch')
    await expect(verifySignedAssignmentPolicy({...finished,
      stateSignature:op.signature}))
      .rejects.toThrow('assignment.state_not_authenticated')
    await expect(verifySignedAssignmentPolicy({...listing,state:'finished'}))
      .rejects.toThrow('assignment.state_not_authenticated')
    expect(()=>assertSignedPolicyProgress(listing,finished)).not.toThrow()
    expect(()=>assertSignedPolicyProgress(finished,listing))
      .toThrow('assignment.state_rollback')
    expect(()=>assertSignedPolicyProgress(finished,{
      ...finished,stateContract:op.contract,
    })).toThrow('assignment.state_equivocation')
    expect(()=>assertSignedPolicyProgress(listing,{
      ...listing,policyContract:'malicious replacement',
    })).toThrow('assignment.original_policy_changed')
  })
  it('authenticates owner-signed policy revision, preserves root and rejects rollback',async()=>{
    const owner='cccccccc-cccc-4ccc-8ccc-ccccccccccca'
    await account(owner)
    const session=activeSession.value!
    await queueAssignmentCreation({
      title:'Revision baseline',instructions:'This remains E2EE',photoGoal:30,
    })
    const [op]=await listAssignmentOperations()
    const creation=JSON.parse(op.contract)
    const initial={
      assignmentId:creation.assignmentId,ownerAccountId:owner,
      ownerAccountSpki:session.pkg.accountSpki,
      state:'active',revision:1,photoGoal:30,confirmedPhotoCount:0,
      policyRevision:1,startsAt:creation.startsAt,endsAt:null,
      privateEnvelope:creation.privateEnvelope,policyContract:op.contract,
      policySignature:op.signature,policyAmendmentContract:null,
      policyAmendmentSignature:null,stateContract:null,stateSignature:null,
    }
    await expect(verifySignedAssignmentPolicy(initial)).resolves.toBeUndefined()
    const originalHash=hex(await digest(new TextEncoder().encode(op.contract)))
    const body=JSON.stringify({
      version:1,operationId:crypto.randomUUID(),assignmentId:creation.assignmentId,
      ownerAccountId:owner,rootPolicyHash:originalHash,
      previousPolicyHash:originalHash,fromPolicyRevision:1,
      toPolicyRevision:2,photoGoal:45,allowedMedia:['photo'],
    })
    const signature=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v1\n'+body)
    const changed={...initial,policyRevision:2,photoGoal:45,
      policyAmendmentContract:body,policyAmendmentSignature:signature}
    await expect(verifySignedAssignmentPolicy(changed)).resolves.toBeUndefined()
    expect(()=>assertSignedPolicyProgress(initial,changed)).not.toThrow()
    expect(()=>assertSignedPolicyProgress(changed,initial))
      .toThrow('assignment.policy_rollback')
    await expect(verifySignedAssignmentPolicy({...changed,photoGoal:50}))
      .rejects.toThrow('assignment.policy_revision_mismatch')
    await expect(verifySignedAssignmentPolicy({...changed,
      policyAmendmentSignature:op.signature}))
      .rejects.toThrow('assignment.policy_revision_not_authenticated')
    const forged=JSON.parse(body)
    forged.rootPolicyHash='0'.repeat(64)
    const forgedContract=JSON.stringify(forged)
    const forgedSignature=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v1\n'+forgedContract)
    await expect(verifySignedAssignmentPolicy({...changed,
      policyAmendmentContract:forgedContract,
      policyAmendmentSignature:forgedSignature,
    })).rejects.toThrow('assignment.policy_revision_mismatch')
    expect(()=>assertSignedPolicyProgress(changed,{
      ...changed,policyAmendmentContract:forgedContract,
    })).toThrow('assignment.policy_equivocation')
  })
  it('enforces signed v2 required metadata before offline capture and preserves rules on goal edits',async()=>{
    const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
    await account(owner)
    const session=activeSession.value!
    const id=await queueAssignmentCreation({
      title:'Required private metadata',instructions:'Never disclose raw GPS',
      photoGoal:30,
    })
    const creation=(await listAssignmentOperations()).find(op=>op.kind==='create')!
    const raw=JSON.parse(creation.contract)
    const originalHash=hex(await digest(new TextEncoder().encode(creation.contract)))
    const amendment={
      version:2,operationId:crypto.randomUUID(),assignmentId:id,
      ownerAccountId:owner,rootPolicyHash:originalHash,
      previousPolicyHash:originalHash,fromPolicyRevision:1,
      toPolicyRevision:2,photoGoal:30,allowedMedia:['photo'],
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    }
    const signed=JSON.stringify(amendment)
    const signature=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v2\n'+signed)
    const listing={
      assignmentId:id,ownerAccountId:owner,ownerAccountSpki:session.pkg.accountSpki,
      state:'active',revision:1,photoGoal:30,confirmedPhotoCount:0,
      policyRevision:2,startsAt:raw.startsAt,endsAt:null,
      privateEnvelope:raw.privateEnvelope,policyContract:creation.contract,
      policySignature:creation.signature,policyAmendmentContract:signed,
      policyAmendmentSignature:signature,stateContract:null,stateSignature:null,
    }
    await expect(verifySignedAssignmentPolicy(listing)).resolves.toBeUndefined()
    expect(signedPolicyRequirements(listing)).toEqual({
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    })
    const idb=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open('pb3-assignment-operation-outbox-v1')
      req.onsuccess=()=>resolve(req.result)
      req.onerror=()=>reject(req.error)
    })
    await new Promise<void>((resolve,reject)=>{
      const tx=idb.transaction('capturePolicies','readwrite')
      tx.objectStore('capturePolicies').put({
        key:owner+'/'+id,accountId:owner,listing,verifiedAt:Date.now(),
      })
      tx.oncomplete=()=>resolve()
      tx.onerror=()=>reject(tx.error)
    })
    idb.close()
    const when=Date.now()
    const base={latitude:41.647849,longitude:41.639411,
      accuracyMeters:4,recordedAt:when-1500}
    await expect(signedCaptureBinding(id,when))
      .rejects.toThrow('assignment.category_required')
    await expect(signedCaptureBinding(id,when,{category:'Report'}))
      .rejects.toThrow('assignment.description_too_short')
    await expect(signedCaptureBinding(id,when,{
      category:'Report',description:'Only ten',
    })).rejects.toThrow('assignment.description_too_short')
    await expect(signedCaptureBinding(id,when,{
      category:'Report',description:'Confidential description',
    })).rejects.toThrow('assignment.gps_required')
    const valid=await signedCaptureBinding(id,when,{
      category:'Report',description:'Confidential description',gps:base,
    })
    expect(valid).toMatchObject({
      assignmentId:id,policyRevision:2,
      policyHash:hex(await digest(new TextEncoder().encode(signed))),
    })
    await expect(verifySignedAssignmentPolicy({
      ...listing,policyAmendmentSignature:creation.signature,
    })).rejects.toThrow('assignment.policy_revision_not_authenticated')
    const tampered={...amendment,descriptionMinLength:0}
    const tamperedText=JSON.stringify(tampered)
    await expect(verifySignedAssignmentPolicy({
      ...listing,policyAmendmentContract:tamperedText,
    })).rejects.toThrow('assignment.policy_revision_not_authenticated')
    await queueAssignmentGoalChange(id,45)
    const pending=(await listAssignmentOperations()).find(op=>op.kind==='policy')!
    const changed=JSON.parse(pending.contract)
    expect(changed).toMatchObject({
      version:6,photoGoal:45,videoGoal:null,audioGoal:null,requiredCategory:true,
      descriptionMinLength:12,requiredGps:true,
    })
    expect(pending.contract).not.toContain('Confidential description')
    expect(pending.contract).not.toContain('41.647849')
  })
  it('caches only account-bound AEAD ciphertext and refuses wrong policy/account',async()=>{
    const accountA='11111111-1111-4111-8111-111111111111'
    const accountB='22222222-2222-4222-8222-222222222222'
    const assignment='33333333-3333-4333-8333-333333333333'
    const policy='{"signed":"immutable-policy-snapshot"}'
    const confidential={
      version:1 as const,
      title:'Private offline title',
      instructions:'Never store unencrypted contributor notes',
    }
    await account(accountA)
    await cachePrivateAssignment(assignment,policy,confidential)
    expect(await readCachedPrivateAssignment(assignment,policy)).toEqual(confidential)
    expect(await readCachedPrivateAssignment(assignment,'{"signed":"tampered"}'))
      .toBeNull()
    const idb=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open('pb3-assignment-operation-outbox-v1')
      req.onsuccess=()=>resolve(req.result)
      req.onerror=()=>reject(req.error)
    })
    try{
      const row=await new Promise<unknown>((resolve,reject)=>{
        const tx=idb.transaction('privateSummaries','readonly')
        const req=tx.objectStore('privateSummaries').get(accountA+'/'+assignment)
        req.onsuccess=()=>resolve(req.result)
        req.onerror=()=>reject(req.error)
      })
      expect(row).toBeDefined()
      expect(JSON.stringify(row)).not.toContain('Private offline title')
      expect(JSON.stringify(row)).not.toContain('Never store')
      expect((row as {ciphertext:Blob}).ciphertext).toBeInstanceOf(Blob)
    }finally{idb.close()}
    await account(accountB)
    expect(await readCachedPrivateAssignment(assignment,policy)).toBeNull()
  })
  it('isolates local draft listings per account and rejects invalid progress targets',async()=>{
    await account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(await listLocalAssignmentDrafts()).toEqual([])
    await expect(queueAssignmentCreation({
      title:'Invalid',instructions:'',photoGoal:10000,
    })).rejects.toThrow('assignment.invalid_goal')
  })
})
