import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { activeSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { digest, freshPackage, hex, importSigner, sign } from '../../identity/infrastructure/crypto'
import { preparePhotoMetadata } from '../../photo-sync/domain/capture-metadata'
import type { StoredPhoto } from '../../photo-sync/application/p1-photo'
import type { AssignmentListing, SignedCaptureBinding } from './assignment-outbox'
import {
  validatePhotoForGrant, verifySignedPolicyHistory,
  rememberSignedPolicyHistory, readSignedPolicyHistoryCache,
} from './submission-preflight'
import type { SignedPolicyHistory, SignedPolicyHistoryEvent } from './submission-preflight'

afterEach(()=>{ activeSession.value=null })
const enc=new TextEncoder()
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function fixture(){
  const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const assignmentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const {pkg}=await freshPackage(accountId)
  activeSession.value={
    accountId,deviceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    pkg,online:false,
  } as Session
  const startsAt=Date.now()-15000
  const root={
    version:1,assignmentId,operationId:crypto.randomUUID(),
    ownerAccountId:accountId,revision:1,policyRevision:1,
    state:'active',startsAt,endsAt:null,
    photoGoal:30,allowedMedia:['photo'],
    privateEnvelope:{version:1,iv:'opaque',ciphertext:'opaque'},
  }
  const rootContract=JSON.stringify(root)
  const rootSignature=await sign(await importSigner(pkg.accountPkcs8),
    'pb3.assignment.v1\n'+rootContract)
  const originalHash=await hash(rootContract)
  const change1={
    version:1,operationId:crypto.randomUUID(),
    assignmentId,ownerAccountId:accountId,
    rootPolicyHash:originalHash,previousPolicyHash:originalHash,
    fromPolicyRevision:1,toPolicyRevision:2,
    photoGoal:45,allowedMedia:['photo'],
  }
  const contract1=JSON.stringify(change1)
  const hash1=await hash(contract1)
  const signature1=await sign(await importSigner(pkg.accountPkcs8),
    'pb3.assignment-policy.v1\n'+contract1)
  const change2={
    version:2,operationId:crypto.randomUUID(),
    assignmentId,ownerAccountId:accountId,
    rootPolicyHash:originalHash,previousPolicyHash:hash1,
    fromPolicyRevision:2,toPolicyRevision:3,
    photoGoal:45,allowedMedia:['photo'],
    requiredCategory:true,descriptionMinLength:12,requiredGps:true,
  }
  const contract2=JSON.stringify(change2)
  const hash2=await hash(contract2)
  const signature2=await sign(await importSigner(pkg.accountPkcs8),
    'pb3.assignment-policy.v2\n'+contract2)
  const event1:SignedPolicyHistoryEvent={
    fromPolicyRevision:1,toPolicyRevision:2,
    contract:contract1,signature:signature1,contractHash:hash1,
    occurredAtMs:startsAt+2000,
  }
  const event2:SignedPolicyHistoryEvent={
    fromPolicyRevision:2,toPolicyRevision:3,
    contract:contract2,signature:signature2,contractHash:hash2,
    occurredAtMs:startsAt+6000,
  }
  const listing:AssignmentListing={
    assignmentId,ownerAccountId:accountId,ownerAccountSpki:pkg.accountSpki,
    state:'active',revision:1,photoGoal:45,confirmedPhotoCount:0,
    policyRevision:3,startsAt,endsAt:null,
    privateEnvelope:root.privateEnvelope as AssignmentListing['privateEnvelope'],
    policyContract:rootContract,policySignature:rootSignature,
    policyAmendmentContract:contract2,policyAmendmentSignature:signature2,
    stateContract:null,stateSignature:null,
  }
  const history:SignedPolicyHistory={
    assignmentId,policyRevision:3,rootPolicyHash:originalHash,
    events:[event1,event2],
  }
  return {assignmentId,accountId,listing,history,hash1,hash2,startsAt,contract1}
}
function localPhoto(capture:SignedCaptureBinding|undefined):StoredPhoto{
  return {
    key:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/'+crypto.randomUUID(),
    accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    photoId:crypto.randomUUID(),operationId:crypto.randomUUID(),
    createdAt:capture?.capturedAt??Date.now(),
    expiresAt:Date.now()+86400000,state:'synced',
    ...(capture?{capture}:{}),assets:[],
  }
}
describe('P1-08 signed historical policy and E2EE grant preflight',()=>{
  it('caches only public owner-signed history and re-verifies it offline per account',async()=>{
    const f=await fixture()
    const original=JSON.stringify(f.history)
    expect(original).not.toContain('Confidential text')
    expect(original).not.toContain('latitude')
    const stored=await rememberSignedPolicyHistory(f.listing,f.history)
    expect(stored).toHaveLength(3)
    const recovered=await readSignedPolicyHistoryCache(f.listing)
    expect(recovered?.map(x=>x.policyHash))
      .toEqual(stored.map(x=>x.policyHash))
    await expect(readSignedPolicyHistoryCache({
      ...f.listing,policyRevision:2,
    })).rejects.toThrow()
    const another='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const {pkg}=await freshPackage(another)
    activeSession.value={
      accountId:another,deviceId:crypto.randomUUID(),pkg,online:false,
    } as Session
    expect(await readSignedPolicyHistoryCache(f.listing)).toBeNull()
  })
  it('verifies every intermediate owner signature and exact chain before trusting an old photo',async()=>{
    const f=await fixture()
    const chain=await verifySignedPolicyHistory(f.listing,f.history)
    expect(chain).toHaveLength(3)
    expect(chain[0]!.validUntil).toBe(f.startsAt+2000)
    expect(chain[1]!.policyHash).toBe(f.hash1)
    expect(chain[1]!.validFrom).toBe(f.startsAt+2000)
    expect(chain[1]!.validUntil).toBe(f.startsAt+6000)
    expect(chain[1]!.requirements.requiredGps).toBe(false)
    expect(chain[2]!.requirements).toEqual({
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    })
    const time=f.startsAt+4000
    const capture={
      assignmentId:f.assignmentId,ownerAccountId:f.accountId,
      policyRevision:2,policyHash:f.hash1,capturedAt:time,
    }
    const photo=localPhoto(capture)
    const privateMetadata=preparePhotoMetadata(time,capture)
    expect(()=>validatePhotoForGrant(
      photo,privateMetadata,f.assignmentId,f.accountId,chain[1]!,
    )).not.toThrow()
    // New v2 rules must NOT retroactively reject the old captured bytes.
    expect(()=>validatePhotoForGrant(
      photo,privateMetadata,f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.capture_scope_mismatch')
    const outsideTime={...capture,capturedAt:f.startsAt+8500}
    expect(()=>validatePhotoForGrant(
      localPhoto(outsideTime),preparePhotoMetadata(outsideTime.capturedAt,outsideTime),
      f.assignmentId,f.accountId,chain[1]!,
    )).toThrow('assignment.capture_policy_not_effective')
  })
  it('verifies owner-signed historical v1/v2/v3/v4 policy timelines and goals',async()=>{
    const f=await fixture()
    const session=activeSession.value!
    const owner=f.accountId,assignmentId=f.assignmentId
    const rootHash=await hash(f.listing.policyContract)
    const v3={
      version:3,operationId:crypto.randomUUID(),assignmentId,
      ownerAccountId:owner,rootPolicyHash:rootHash,
      previousPolicyHash:f.hash2,fromPolicyRevision:3,toPolicyRevision:4,
      photoGoal:45,allowedMedia:['photo','video'],
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    }
    const contract3=JSON.stringify(v3),hash3=await hash(contract3)
    const signature3=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v3\n'+contract3)
    const v4={
      ...v3,version:4,operationId:crypto.randomUUID(),
      previousPolicyHash:hash3,fromPolicyRevision:4,toPolicyRevision:5,
      allowedMedia:['photo','video','audio'],videoGoal:2,audioGoal:1,
    }
    const contract4=JSON.stringify(v4),hash4=await hash(contract4)
    const signature4=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v4\n'+contract4)
    const history:SignedPolicyHistory={
      ...f.history,policyRevision:5,events:[
        ...f.history.events,
        {fromPolicyRevision:3,toPolicyRevision:4,
          contract:contract3,signature:signature3,contractHash:hash3,
          occurredAtMs:f.startsAt+8000},
        {fromPolicyRevision:4,toPolicyRevision:5,
          contract:contract4,signature:signature4,contractHash:hash4,
          occurredAtMs:f.startsAt+10000},
      ],
    }
    const latest:AssignmentListing={
      ...f.listing,policyRevision:5,
      policyAmendmentContract:contract4,policyAmendmentSignature:signature4,
      videoGoal:2,audioGoal:1,
    }
    // A past signed history must be refreshed on a newer signed revision,
    // not treated as forged, and never used to authorize a stale E2EE grant.
    await rememberSignedPolicyHistory(f.listing,f.history)
    expect(await readSignedPolicyHistoryCache(latest)).toBeNull()
    const chain=await rememberSignedPolicyHistory(latest,history)
    expect(chain.map(x=>x.revision)).toEqual([1,2,3,4,5])
    expect(chain[0]!.validUntil).toBe(f.startsAt+2000)
    expect(chain[3]!.validUntil).toBe(f.startsAt+10000)
    expect(chain[4]!.requirements).toEqual({
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
    })
    // Wrong server-side per-kind target projection is rejected before caching
    // or using any older policy timeline.
    await expect(verifySignedPolicyHistory({...latest,videoGoal:3},history))
      .rejects.toThrow('assignment.invalid_signed_goal')
    const old={assignmentId,ownerAccountId:owner,
      policyRevision:1,policyHash:rootHash,capturedAt:f.startsAt+1000}
    expect(()=>validatePhotoForGrant(
      localPhoto(old),preparePhotoMetadata(old.capturedAt,old),
      assignmentId,owner,chain[0]!,
    )).not.toThrow()
    const backdated={...old,capturedAt:f.startsAt+3000}
    expect(()=>validatePhotoForGrant(
      localPhoto(backdated),preparePhotoMetadata(backdated.capturedAt,backdated),
      assignmentId,owner,chain[0]!,
    )).toThrow('assignment.capture_policy_not_effective')
  })
  it('authenticates v6 historical photo allowed categories and required tags before DEK grant',async()=>{
    const f=await fixture()
    const session=activeSession.value!
    const v6={
      version:6,operationId:crypto.randomUUID(),
      assignmentId:f.assignmentId,ownerAccountId:f.accountId,
      rootPolicyHash:await hash(f.listing.policyContract),
      previousPolicyHash:f.hash2,fromPolicyRevision:3,toPolicyRevision:4,
      photoGoal:45,allowedMedia:['photo'],
      requiredCategory:true,descriptionMinLength:12,requiredGps:true,
      videoGoal:null,audioGoal:null,
      videoRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      audioRequirements:{requiredCategory:false,descriptionMinLength:0,requiredGps:false},
      photoAdvanced:{allowedCategories:['Report'],requiredTags:['evidence']},
      videoAdvanced:{allowedCategories:[],requiredTags:[]},
      audioAdvanced:{allowedCategories:[],requiredTags:[]},
    }
    const contract=JSON.stringify(v6),digestValue=await hash(contract)
    const signature=await sign(await importSigner(session.pkg.accountPkcs8),
      'pb3.assignment-policy.v6\n'+contract)
    const history:SignedPolicyHistory={
      ...f.history,policyRevision:4,events:[...f.history.events,{
        fromPolicyRevision:3,toPolicyRevision:4,
        contract,signature,contractHash:digestValue,
        occurredAtMs:f.startsAt+10000,
      }],
    }
    const latest={...f.listing,policyRevision:4,
      policyAmendmentContract:contract,policyAmendmentSignature:signature}
    const chain=await verifySignedPolicyHistory(latest,history)
    expect(chain).toHaveLength(4)
    expect(chain[2]!.advanced.requiredTags).toEqual([])
    expect(chain[3]!.advanced).toEqual({
      allowedCategories:['Report'],requiredTags:['evidence'],
    })
    const time=f.startsAt+11000
    const capture={
      assignmentId:f.assignmentId,ownerAccountId:f.accountId,
      policyRevision:4,policyHash:digestValue,capturedAt:time,
    }
    const base={
      description:'Confidential data',
      gps:{latitude:41.65,longitude:41.64,accuracyMeters:5,recordedAt:time-600},
    }
    const photo=localPhoto(capture)
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture,{
      ...base,category:'Interview',tags:['evidence'],
    }),f.assignmentId,f.accountId,chain[3]!))
      .toThrow('assignment.category_not_allowed')
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture,{
      ...base,category:'Report',
    }),f.assignmentId,f.accountId,chain[3]!))
      .toThrow('assignment.required_tags_missing')
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture,{
      ...base,category:'Report',tags:['evidence'],
    }),f.assignmentId,f.accountId,chain[3]!))
      .not.toThrow()
    // Historical v2 photo does not acquire the new v6 tags retroactively.
    const oldTime=f.startsAt+8500
    const oldCapture={...capture,policyRevision:3,policyHash:f.hash2,capturedAt:oldTime}
    expect(()=>validatePhotoForGrant(localPhoto(oldCapture),
      preparePhotoMetadata(oldTime,oldCapture,{
        ...base,gps:{...base.gps,recordedAt:oldTime-300},
        category:'Interview',
      }),f.assignmentId,f.accountId,chain[2]!))
      .not.toThrow()
  })
  it('fails closed on modified history, missing event, forged signature or changed ancestry',async()=>{
    const f=await fixture()
    await expect(verifySignedPolicyHistory(f.listing,{
      ...f.history,events:f.history.events.slice(1),
    })).rejects.toThrow('assignment.policy_history_invalid')
    await expect(verifySignedPolicyHistory(f.listing,{
      ...f.history,events:[{...f.history.events[0]!,signature:'not-a-signature'},
        f.history.events[1]!],
    })).rejects.toThrow()
    const fake=JSON.parse(f.contract1)
    fake.previousPolicyHash='0'.repeat(64)
    const bad=JSON.stringify(fake)
    await expect(verifySignedPolicyHistory(f.listing,{
      ...f.history,events:[{...f.history.events[0]!,
        contract:bad,contractHash:await hash(bad)},f.history.events[1]!],
    })).rejects.toThrow('assignment.policy_history_invalid')
    await expect(verifySignedPolicyHistory(f.listing,{
      ...f.history,events:[f.history.events[0]!,{
        ...f.history.events[1]!,occurredAtMs:f.startsAt+1,
      }],
    })).rejects.toThrow('assignment.policy_history_invalid')
  })
  it('checks decrypted private requirements and forbids wrong-scope grants',async()=>{
    const f=await fixture()
    const chain=await verifySignedPolicyHistory(f.listing,f.history)
    const time=f.startsAt+8500
    const capture={
      assignmentId:f.assignmentId,ownerAccountId:f.accountId,
      policyRevision:3,policyHash:f.hash2,capturedAt:time,
    }
    const photo=localPhoto(capture)
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture),
      f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.category_required')
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture,{
      category:'Report',
    }),f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.description_too_short')
    expect(()=>validatePhotoForGrant(photo,preparePhotoMetadata(time,capture,{
      category:'Report',description:'Confidential text',
    }),f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.gps_required')
    const complete=preparePhotoMetadata(time,capture,{
      category:'Report',description:'Confidential text',
      gps:{latitude:41.64,longitude:41.67,accuracyMeters:5,recordedAt:time-2000},
    })
    expect(()=>validatePhotoForGrant(photo,complete,
      f.assignmentId,f.accountId,chain[2]!,
    )).not.toThrow()
    expect(()=>validatePhotoForGrant(photo,complete,
      crypto.randomUUID(),f.accountId,chain[2]!,
    )).toThrow('assignment.capture_scope_mismatch')
    expect(()=>validatePhotoForGrant(photo,{
      ...complete,capturedAt:time+1,
    },f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.capture_metadata_mismatch')
    const personal=localPhoto(undefined)
    personal.createdAt=time
    expect(()=>validatePhotoForGrant(personal,preparePhotoMetadata(time),
      f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.category_required')
    expect(()=>validatePhotoForGrant({...personal,state:'retry'},complete,
      f.assignmentId,f.accountId,chain[2]!,
    )).toThrow('assignment.photo_not_synced')
  })
})
