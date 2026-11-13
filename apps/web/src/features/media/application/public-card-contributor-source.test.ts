import 'fake-indexeddb/auto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {
  b64,digest,exportSpki,freshPackage,hex,newSigning,sign,
} from '../../identity/infrastructure/crypto'
import type {SafeDerivativeCandidate} from './safe-derivatives'
import {prepareContributorReviewSource} from './public-card-contributor-source'

const m=vi.hoisted(()=>({
  candidate:vi.fn(),media:vi.fn(),operations:vi.fn(),
  policies:vi.fn(),grants:vi.fn(),read:vi.fn(),sanitize:vi.fn(),
  assignmentVerified:vi.fn(),validMedia:vi.fn(),
}))
vi.mock('./safe-derivatives',()=>({
  requireSafeDerivativeCandidate:m.candidate,
}))
vi.mock('./media-outbox',()=>({
  listLocalMedia:m.media,readLocalMedia:m.read,
}))
vi.mock('./media-grants',async()=>{
  const real=await vi.importActual<typeof import('./media-grants')>('./media-grants')
  return {
    parseMediaGrantContract:real.parseMediaGrantContract,
    listOutgoingMediaGrants:m.grants,
  }
})
vi.mock('../domain/media-crypto',()=>({
  validateMediaContract:m.validMedia,
}))
vi.mock('./public-card-safe-jpeg',()=>({
  prepareSafePublicJpeg:m.sanitize,
}))
vi.mock('../../assignments/application/assignment-outbox',()=>({
  assignmentFilesOpenAt:()=>true,
  assignmentGrantExpiryCap:()=>null,
  listCachedAssignmentSnapshots:m.policies,
  listAssignmentOperations:m.operations,
  mediaSubmissionSigningDomain:(version:unknown)=>{
    if(version!==3&&version!==4)throw Error('invalid_domain')
    return 'pb3.assignment-media-submit.v'+version+'\n'
  },
  verifySignedAssignmentPolicy:m.assignmentVerified,
}))

const id=()=>crypto.randomUUID()
const enc=new TextEncoder()
let session:Session
let safeCandidate:SafeDerivativeCandidate
let sourceContract:Record<string,unknown>
let safeContract:Record<string,unknown>
let source:{accountId:string;mediaId:string;state:string;mediaType:string;expiresAt:number;contract:Record<string,unknown>;signature:string;capture?:{contract:string;signature:string}}
let safe:{accountId:string;mediaId:string;state:string;mediaType:string;expiresAt:number;contract:Record<string,unknown>;signature:string}
let assignment:{assignmentId:string;ownerAccountId:string;policyRevision:number;state:string;policyContract:string;policyAmendmentContract:null}
let operation:{accountId:string;kind:string;state:string;contract:string;signature:string;path:string}
let grant:{id:string;state:string;ownerAccountId:string;recipientAccountId:string;mediaId:string;contract:string;signature:string}
let payload:Record<string,unknown>
let grantPayload:Record<string,unknown>
let reviewResult:{blob:Blob;width:number;height:number;sha256:string;published:false;humanReviewRequired:true}

async function hash(raw:string):Promise<string>{
  return hex(await digest(enc.encode(raw)))
}
async function signedMedia(record:typeof source):Promise<void>{
  record.signature=await sign(session.device.deviceKey,
    'pb3.media.v1\n'+JSON.stringify(record.contract))
}
async function operationSigned():Promise<void>{
  operation.contract=JSON.stringify(payload)
  const key=await import('./public-card-contributor-source')
  void key // Keep the import in the test to prove module resolves.
  operation.signature=await sign(
    await (await import('../../identity/infrastructure/crypto'))
      .importSigner(session.pkg.accountPkcs8),
    'pb3.assignment-media-submit.v'+payload.version+'\n'+operation.contract,
  )
}
async function grantSigned():Promise<void>{
  grant.contract=JSON.stringify(grantPayload)
  grant.signature=await sign(
    await (await import('../../identity/infrastructure/crypto'))
      .importSigner(session.pkg.accountPkcs8),
    'pb3.media-grant.v2\n'+grant.contract,
  )
}
const decide=()=>prepareContributorReviewSource(safeCandidate)
beforeEach(async()=>{
  vi.clearAllMocks()
  const accountId=id()
  const {pkg}=await freshPackage(accountId)
  const pair=await newSigning(true)
  session={
    accountId,deviceId:id(),pkg,online:false,
    device:{deviceId:id(),deviceSpki:await exportSpki(pair.publicKey),
      deviceKey:pair.privateKey},
  } as unknown as Session
  activeSession.value=session
  const expires=Date.now()+60*60*1000
  sourceContract={
    version:1,accountId,mediaId:id(),mediaType:'photo',
    expiresAt:expires,chunkBytes:1048576,plainBytes:4444,
  }
  safeContract={
    version:1,accountId,mediaId:id(),mediaType:'photo',
    expiresAt:expires,chunkBytes:1048576,plainBytes:3333,
  }
  source={
    accountId,mediaId:sourceContract.mediaId as string,state:'synced',
    mediaType:'photo',expiresAt:expires,contract:sourceContract,signature:'',
  }
  safe={
    accountId,mediaId:safeContract.mediaId as string,state:'synced',
    mediaType:'photo',expiresAt:expires,contract:safeContract,signature:'',
  }
  await signedMedia(source)
  await signedMedia(safe)
  safeCandidate={
    key:accountId+'/'+safe.mediaId,accountId,
    sourceMediaId:source.mediaId,safeMediaId:safe.mediaId,
    sourceContractHash:await hash(JSON.stringify(sourceContract)),
    safeContractHash:await hash(JSON.stringify(safeContract)),
    createdAt:Date.now(),
  }
  assignment={
    assignmentId:id(),ownerAccountId:id(),policyRevision:1,
    state:'active',policyContract:JSON.stringify({version:1}),
    policyAmendmentContract:null,
  }
  payload={
    version:3,submissionId:id(),operationId:id(),
    assignmentId:assignment.assignmentId,
    contributorAccountId:accountId,mediaId:source.mediaId,
    mediaGrantId:id(),
    mediaContractHash:safeCandidate.sourceContractHash,
    policyRevision:1,policyHash:await hash(assignment.policyContract),
    kind:'photo',
  }
  operation={
    accountId,kind:'media-submit',state:'sent',
    contract:'',signature:'',
    path:'/assignments/v1/'+assignment.assignmentId+'/media-submissions',
  }
  await operationSigned()
  grantPayload={
    version:2,grantId:payload.mediaGrantId,
    mediaId:source.mediaId,ownerAccountId:accountId,
    recipientAccountId:assignment.ownerAccountId,
    assignmentId:assignment.assignmentId,
    recipientKeyDigest:'b'.repeat(64),
    mediaContractHash:safeCandidate.sourceContractHash,
    scope:'read',expiresAt:Date.now()+1_800_000,
    envelope:{
      ephemeralSpki:'fixture-recipient-ephemeral',
      salt:b64(new Uint8Array(16).fill(1)),
      iv:b64(new Uint8Array(12).fill(2)),
      ciphertext:b64(new Uint8Array(48).fill(3)),
    },
  }
  grant={
    id:payload.mediaGrantId as string,state:'sent',ownerAccountId:accountId,
    recipientAccountId:assignment.ownerAccountId,mediaId:source.mediaId,
    contract:'',signature:'',
  }
  await grantSigned()
  reviewResult={
    blob:new Blob(['flattened-by-browser'],{type:'image/jpeg'}),
    width:3,height:2,sha256:'c'.repeat(64),
    published:false,humanReviewRequired:true,
  }
  m.candidate.mockImplementation(async()=>({...safeCandidate}))
  m.media.mockImplementation(async()=>[source,safe])
  m.operations.mockImplementation(async()=>[operation])
  m.policies.mockImplementation(async()=>[assignment])
  m.grants.mockImplementation(async()=>[grant])
  m.read.mockResolvedValue({
    blob:new Blob(['private-safe-jpeg'],{type:'image/jpeg'}),
    metadata:{mime:'image/jpeg'},
  })
  m.sanitize.mockResolvedValue(reviewResult)
  m.assignmentVerified.mockResolvedValue(undefined)
  m.validMedia.mockImplementation(()=>undefined)
})
afterEach(()=>{
  activeSession.value=null
  vi.restoreAllMocks()
})

describe('#211 contributor local signed submission → actual safe JPEG reviewer',()=>{
  it('opens ONLY AES-GCM decrypted safe file, never original, no remote URL or grant',async()=>{
    const r=await decide()
    expect(r.localOnly).toBe(true)
    expect(r.published).toBe(false)
    expect(r.publicAuthorized).toBe(false)
    expect(r.prepared).toBe(reviewResult)
    expect(r.binding).toMatchObject({
      assignmentId:assignment.assignmentId,
      submissionId:payload.submissionId,
      sourceMediaId:source.mediaId,safeMediaId:safe.mediaId,
      sourceContractHash:safeCandidate.sourceContractHash,
      submissionContractHash:await hash(operation.contract),
    })
    expect(m.read).toHaveBeenCalledTimes(1)
    expect(m.read).toHaveBeenCalledWith(safe.mediaId)
    expect(m.sanitize).toHaveBeenCalledTimes(1)
    expect(m.assignmentVerified).toHaveBeenCalled()
    expect(m.validMedia).toHaveBeenCalledTimes(2)
  })
  it('rejects unregistered or substituted own safe derivative, no plaintext read',async()=>{
    m.candidate.mockRejectedValue(Error('safe_media.unregistered_derivative'))
    await expect(decide()).rejects.toThrow('safe_media.unregistered_derivative')
    m.candidate.mockResolvedValue({...safeCandidate,safeContractHash:'f'.repeat(64)})
    await expect(decide()).rejects.toThrow('public_card.source_candidate_changed')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('rejects guest/other-account source/safe, missing or unsynced photo',async()=>{
    safe.accountId=id()
    await expect(decide()).rejects.toThrow('public_card.source_media_invalid')
    safe.accountId=session.accountId
    safe.state='queued'
    await expect(decide()).rejects.toThrow('public_card.source_media_invalid')
    safe.state='synced'
    safe.mediaType='video'
    await expect(decide()).rejects.toThrow('public_card.source_media_invalid')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('rejects altered manifest even with hash matching attacker-controlled row',async()=>{
    source.contract={...source.contract,plainBytes:100}
    safeCandidate.sourceContractHash=await hash(JSON.stringify(source.contract))
    m.candidate.mockImplementation(async()=>({...safeCandidate}))
    await expect(decide()).rejects.toThrow(
      'public_card.source_media_signature_invalid')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('only an account-root signed, sent, unambiguous P2 photo submission qualifies',async()=>{
    operation.state='queued'
    await expect(decide()).rejects.toThrow(
      'public_card.source_single_sent_submission_required')
    operation.state='sent'
    operation.signature='a'.repeat(86)
    await expect(decide()).rejects.toThrow(
      'public_card.source_submission_signature_invalid')
    await operationSigned()
    m.operations.mockImplementation(async()=>[operation,operation])
    await expect(decide()).rejects.toThrow(
      'public_card.source_single_sent_submission_required')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('fails on wrong submission source, policy hash and changed assignment',async()=>{
    payload.policyHash='f'.repeat(64)
    await operationSigned()
    await expect(decide()).rejects.toThrow(
      'public_card.source_assignment_policy_changed')
    payload.policyHash=await hash(assignment.policyContract)
    payload.assignmentId=id()
    await operationSigned()
    await expect(decide()).rejects.toThrow(
      'public_card.source_signed_assignment_unavailable')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('rejects untrusted owner signed policy, expired retention and owner impersonation',async()=>{
    m.assignmentVerified.mockRejectedValue(Error('assignment.untrusted_capture_policy'))
    await expect(decide()).rejects.toThrow('assignment.untrusted_capture_policy')
    m.assignmentVerified.mockResolvedValue(undefined)
    assignment.state='finished'
    await expect(decide()).rejects.toThrow(
      'public_card.source_signed_assignment_unavailable')
    assignment.state='active';assignment.ownerAccountId=session.accountId
    await expect(decide()).rejects.toThrow(
      'public_card.source_signed_assignment_unavailable')
  })
  it('does not substitute private Safe recipient grant for scoped source grant',async()=>{
    grantPayload.scope='safe_read'
    await grantSigned()
    await expect(decide()).rejects.toThrow('public_card.source_scoped_grant_invalid')
    grantPayload.scope='read'
    grantPayload.mediaId=safe.mediaId
    await grantSigned()
    await expect(decide()).rejects.toThrow('public_card.source_scoped_grant_invalid')
    grantPayload.mediaId=source.mediaId
    grant.state='queued'
    await grantSigned()
    await expect(decide()).rejects.toThrow('public_card.source_scoped_grant_missing')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('denies expired scoped grant, mismatch and forged root signature',async()=>{
    grantPayload.expiresAt=Date.now()-1
    await grantSigned()
    await expect(decide()).rejects.toThrow('public_card.source_scoped_grant_invalid')
    grantPayload.expiresAt=Date.now()+100000
    grantPayload.mediaContractHash='f'.repeat(64)
    await grantSigned()
    await expect(decide()).rejects.toThrow('public_card.source_scoped_grant_invalid')
    grantPayload.mediaContractHash=safeCandidate.sourceContractHash
    await grantSigned()
    grant.signature='not-a-signature'
    await expect(decide()).rejects.toThrow()
    expect(m.read).not.toHaveBeenCalled()
  })
  it('refuses to review original/private metadata or non-JPEG Safe content',async()=>{
    m.read.mockResolvedValue({
      blob:new Blob(['private-safe'],{type:'image/png'}),
      metadata:{mime:'image/png'},
    })
    await expect(decide()).rejects.toThrow('public_card.source_safe_jpeg_required')
    expect(m.sanitize).not.toHaveBeenCalled()
    expect(m.read).toHaveBeenCalledWith(safe.mediaId)
  })
  it('fails closed when session changes during local media decryption',async()=>{
    m.read.mockImplementation(async()=>{
      activeSession.value={...session,online:true}
      return {
        blob:new Blob(['private-safe'],{type:'image/jpeg'}),
        metadata:{mime:'image/jpeg'},
      }
    })
    await expect(decide()).rejects.toThrow('public_card.source_identity_changed')
    expect(m.sanitize).not.toHaveBeenCalled()
  })
  it('does not render stale safe copy after signed assignment is locally revoked mid-Canvas',async()=>{
    let count=0
    m.policies.mockImplementation(async()=>{
      count++
      return count===1?[assignment]:[]
    })
    await expect(decide()).rejects.toThrow(
      'public_card.source_changed_during_review')
    expect(m.read).toHaveBeenCalledWith(safe.mediaId)
  })
  it('binds contributor P256 signed source capture to the P2 v4 submitted operation',async()=>{
    const capture={
      version:1,assignmentId:assignment.assignmentId,
      ownerAccountId:assignment.ownerAccountId,
      contributorAccountId:session.accountId,
      policyRevision:1,policyHash:payload.policyHash,
      mediaId:source.mediaId,mediaContractHash:safeCandidate.sourceContractHash,
      mediaType:'photo',startedAt:Date.now()-10000,finishedAt:Date.now()-5000,
    }
    const raw=JSON.stringify(capture)
    source.capture={
      contract:raw,signature:await sign(
        await (await import('../../identity/infrastructure/crypto'))
          .importSigner(session.pkg.accountPkcs8),
        'pb3.assignment-media-capture.v1\n'+raw,
      ),
    }
    payload={
      ...payload,version:4,
      captureContract:source.capture.contract,
      captureSignature:source.capture.signature,
    }
    await operationSigned()
    expect((await decide()).binding.submissionId).toBe(payload.submissionId)
    payload.captureSignature='forged'
    await operationSigned()
    await expect(decide()).rejects.toThrow(
      'public_card.source_capture_substituted')
  })
})
