// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,h,nextTick,type App} from 'vue'
import {activeSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import MediaSharePanel from './MediaSharePanel.vue'

const m=vi.hoisted(()=>({
  safe:vi.fn(),preview:vi.fn(),hydrateGrants:vi.fn(),prepare:vi.fn(),
  inspect:vi.fn(),incoming:vi.fn(),
}))
vi.mock('./PublicCardConsentReview.vue',()=>({
  default:{
    props:['prepared','binding'],
    template:'<div data-testid="media-contributor-public-card-review">{{ prepared.sha256 }} · {{ binding.submissionId }}</div>',
  },
}))
vi.mock('../application/public-card-contributor-source',()=>({
  prepareContributorReviewSource:m.prepare,
}))
vi.mock('../application/safe-derivatives',()=>({
  listSafeDerivativeCandidates:m.safe,
}))
vi.mock('../application/media-grants',()=>({
  attachMediaGrantLifecycle:()=>()=>{},
  flushMediaGrants:vi.fn(),listOutgoingMediaGrants:m.hydrateGrants,
  listReceivedMediaGrants:m.incoming,queueMediaRecipientGrant:vi.fn(),
  queueMediaSafeRecipientGrant:vi.fn(),readReceivedMediaGrant:vi.fn(),
  revokeMediaGrant:vi.fn(),parseMediaGrantContract:vi.fn(),
}))
vi.mock('../../sharing/key-directory',()=>({
  confirmPeer:vi.fn(),ensureOwnExchangeKey:vi.fn(),
  inspectPeer:m.inspect,
}))
vi.mock('../application/media-file-preview-policy',()=>({
  emptyPreviewFields:()=>({
    description:false,capturedAt:false,updatedAt:false,tags:false,
    authorTeam:false,gps:false,metadata:false,
  }),
  loadFilePreviewDraft:vi.fn(),queueFilePreviewDraft:vi.fn(),
  flushFilePreviewDrafts:vi.fn(),filePreviewDraftStatus:vi.fn(),
  PREVIEW_FIELD_KEYS:[
    'description','capturedAt','updatedAt','tags',
    'authorTeam','gps','metadata',
  ],
}))
vi.mock('../application/safe-assignment-editorial',()=>({
  queueEditorialLink:vi.fn(),queueEditorialDetach:vi.fn(),
  readEditorialLink:vi.fn(),flushEditorialLinks:vi.fn(),
  editorialLinkState:vi.fn(),
}))
vi.mock('../../assignments/application/assignment-outbox',()=>({
  listServerAssignments:vi.fn(),verifySignedAssignmentPolicy:vi.fn(),
}))
const id=(x:string)=>x.repeat(8)+'-'+x.repeat(4)+'-4'+x.repeat(3)
  +'-8'+x.repeat(3)+'-'+x.repeat(12)
const candidate={
  key:'owner-key',accountId:id('1'),sourceMediaId:id('4'),
  safeMediaId:id('5'),sourceContractHash:'a'.repeat(64),
  safeContractHash:'b'.repeat(64),createdAt:Date.now(),
}
const privateReview={
  prepared:{
    blob:new Blob(['safe'],{type:'image/jpeg'}),
    width:3,height:2,sha256:'c'.repeat(64),
    published:false,humanReviewRequired:true,
  },
  binding:{
    assignmentId:id('2'),submissionId:id('3'),
    submissionContractHash:'d'.repeat(64),
    sourceMediaId:id('4'),sourceContractHash:'a'.repeat(64),
    safeMediaId:id('5'),sourceExpiresAt:Date.now()+100000,
    safeExpiresAt:Date.now()+100000,assignmentExpiresAt:Date.now()+100000,
  },
  localOnly:true,published:false,publicAuthorized:false,
}
function session(account=id('1')):Session{
  return {
    accountId:account,deviceId:id('9'),online:false,
    pkg:{
      v:2,accountId:account,
      accountSpki:'spki',accountPkcs8:'pkcs8',akek:'akek',
      signingKeyId:'sig',wrappingKeyId:'wrap',revision:1,
    },
  } as unknown as Session
}
let app:App|undefined
let host:HTMLDivElement
async function settle():Promise<void>{
  for(let i=0;i<7;i++){await Promise.resolve();await nextTick()}
}
async function mount():Promise<void>{
  activeSession.value=session()
  host=document.createElement('div');document.body.append(host)
  app=createApp({render:()=>h(MediaSharePanel,{localMedia:[]})})
  app.mount(host)
  await settle()
}
const button=()=>host.querySelector<HTMLButtonElement>(
  '[data-testid="media-open-public-card-consent-review"]'
)
beforeEach(()=>{
  vi.resetAllMocks()
  m.safe.mockResolvedValue([{...candidate}])
  m.hydrateGrants.mockResolvedValue([])
  m.incoming.mockResolvedValue([])
  m.prepare.mockResolvedValue(privateReview)
  m.inspect.mockResolvedValue({directory:{safetyFingerprint:'CURRENT'},confirmed:false})
})
afterEach(()=>{
  app?.unmount();app=undefined
  host?.remove()
  activeSession.value=null
})
describe('#211 actual PB3 media panel private contributor review entry',()=>{
  it('shows the real safe-candidate button, never prepares consent on render',async()=>{
    await mount()
    expect(button()).not.toBeNull()
    expect(m.prepare).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="media-contributor-public-card-review"]'))
      .toBeNull()
  })
  it('opens bound, prepublication-only viewer from explicit safe-candidate click',async()=>{
    await mount()
    button()!.click()
    await settle()
    expect(m.prepare).toHaveBeenCalledTimes(1)
    expect(m.prepare).toHaveBeenCalledWith(candidate)
    const reviewer=host.querySelector<HTMLElement>(
      '[data-testid="media-contributor-public-card-review"]'
    )
    expect(reviewer).not.toBeNull()
    expect(reviewer!.textContent).toContain(privateReview.prepared.sha256)
    expect(reviewer!.textContent).toContain(privateReview.binding.submissionId)
    expect(host.textContent).toContain('Публикация выключена')
  })
  it('never mounts stale opened JPEG after a concurrent identity switch',async()=>{
    let resolve!: (value:typeof privateReview)=>void
    m.prepare.mockImplementation(()=>new Promise<typeof privateReview>(
      yes=>{resolve=yes}))
    await mount()
    button()!.click()
    await settle()
    activeSession.value=session(id('6'))
    await settle()
    resolve(privateReview)
    await settle()
    expect(host.querySelector('[data-testid="media-contributor-public-card-review"]'))
      .toBeNull()
  })
  it('removes old account media grant states immediately on identity switch',async()=>{
    m.hydrateGrants.mockResolvedValue([{
      id:'OLD-GRANT',accountId:id('1'),mediaId:id('4'),state:'sent',
      contract:'',signature:'',
    }])
    await mount()
    expect(host.textContent).toContain('OLD-GRAN')
    const input=host.querySelector<HTMLInputElement>('#media-share-peer-id')!
    input.value=id('3');input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    activeSession.value=session(id('6'))
    await settle()
    expect(input.value).toBe('')
    expect(host.textContent).not.toContain('OLD-GRAN')
    expect(host.textContent).not.toContain('CURRENT')
  })
  it('rejects delayed old-account grant hydration after recovery',async()=>{
    let resolveOld!:(value:unknown[])=>void
    m.hydrateGrants.mockImplementationOnce(()=>new Promise<unknown[]>(
      resolve=>{resolveOld=resolve}))
    await mount()
    activeSession.value=session(id('6'))
    await settle()
    resolveOld([{
      id:'OLD-GRANT',mediaId:id('4'),state:'sent',contract:'',signature:'',
    }])
    await settle()
    expect(host.textContent).not.toContain('OLD-GRAN')
    expect(host.textContent).not.toContain('OLD-GRANT')
  })
  it('drops the stale recipient fingerprint from a pending check after account switch',async()=>{
    activeSession.value={...session(),online:true}
    let resolvePeer!:(value:{directory:{safetyFingerprint:string};confirmed:boolean})=>void
    m.inspect.mockImplementationOnce(()=>new Promise(resolve=>{resolvePeer=resolve}))
    host=document.createElement('div');document.body.append(host)
    app=createApp({render:()=>h(MediaSharePanel,{localMedia:[]})})
    app.mount(host)
    await settle()
    const input=host.querySelector<HTMLInputElement>('#media-share-peer-id')!
    input.value=id('3');input.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    const button=Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(node=>node.textContent?.includes('Проверить получателя медиа'))!
    button.click()
    await settle()
    activeSession.value=session(id('6'))
    await settle()
    resolvePeer({directory:{safetyFingerprint:'OLD-SECRET-FINGERPRINT'},confirmed:false})
    await settle()
    expect(host.textContent).not.toContain('OLD-SECRET-FINGERPRINT')
    expect(input.value).toBe('')
  })
  it('reports fail-closed signed-binding error without showing any image',async()=>{
    m.prepare.mockRejectedValue(Error('public_card.source_submission_signature_invalid'))
    await mount()
    button()!.click()
    await settle()
    expect(host.querySelector('[data-testid="media-contributor-public-card-review"]'))
      .toBeNull()
    expect(host.textContent).toContain('public_card.source_submission_signature_invalid')
  })
})
