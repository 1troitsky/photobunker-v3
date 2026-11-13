// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, markRaw, nextTick, reactive, type App } from 'vue'
import { activeSession, type Session } from '../features/identity/application/session'
import CaptureView from './CaptureView.vue'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), policies: vi.fn(), server: vi.fn(), binding: vi.fn(),
  mediaEnqueue: vi.fn(), mediaIntent: vi.fn(),
  requiredGps:false,
  privateCache: vi.fn(), verifyPolicy: vi.fn(), privateScope: vi.fn(),
  allowedMedia: ['photo'] as string[],
  route: {query: {} as Record<string, string>},
}))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  RouterLink: {template: '<a><slot /></a>'},
}))
vi.mock('../features/photo-sync/application/p1-photo', () => ({captureEncrypted: mocks.capture}))
vi.mock('../features/media/application/media-outbox', () => ({enqueueEncryptedMedia: mocks.mediaEnqueue}))
vi.mock('../features/assignments/application/assignment-outbox', () => ({
  listServerAssignments: mocks.server, listAllServerAssignments: mocks.server,
  listVerifiedCapturePolicies: mocks.policies,
  signedCaptureBinding: mocks.binding,
  signedAllowedAssignmentMedia: () => mocks.allowedMedia,
  readCachedPrivateAssignment: mocks.privateCache,
  verifySignedAssignmentPolicy: mocks.verifyPolicy,
  assignmentPrivateCacheScope: mocks.privateScope,
  signedMediaCaptureIntent: mocks.mediaIntent,
  signedAdvancedRequirements: () => ({allowedCategories:[],requiredTags:[]}),
  signedPolicyRequirements: () => ({
    requiredCategory:false,descriptionMinLength:0,requiredGps:mocks.requiredGps,
  }),
  signedMediaRequirements: () => ({
    requiredCategory:false,descriptionMinLength:0,requiredGps:mocks.requiredGps,
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}
function identity(): Session {
  return {
    accountId: 'account-a', deviceId: 'device-a', online: false,
    device: {accountId: 'account-a', deviceId: 'device-a', deviceSpki: 'device-public',
      deviceKey: {} as CryptoKey, encryptionKey: {} as CryptoKey, envelope: {}},
    pkg: {v: 2, accountId: 'account-a', accountSpki: 'account-public', accountPkcs8: 'private-fixture',
      akek: 'wrap-fixture', signingKeyId: 'signing-id', wrappingKeyId: 'wrapping-id', revision: 1},
  } as Session
}
function media() {
  const listeners = new Set<() => void>()
  const track = {
    readyState: 'live',
    stop: vi.fn(() => {track.readyState = 'ended'}),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if(type==='ended')listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if(type==='ended')listeners.delete(listener)
    }),
  }
  const emitEnded = () => {
    track.readyState='ended'
    for(const listener of [...listeners])listener()
  }
  return {stream: markRaw({getTracks: () => [track]}) as unknown as MediaStream,
    track,emitEnded}
}
async function settle() { for (let i = 0; i < 8; i++) {await Promise.resolve(); await nextTick()} }
let app: App | undefined
let host: HTMLDivElement
let requests: ReturnType<typeof deferred<MediaStream>>[]
let getUserMedia: ReturnType<typeof vi.fn>
let play = vi.fn<() => Promise<void>>()
function button(text: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find(el => el.textContent?.trim() === text)!
}
async function mount(session = identity()) {
  activeSession.value = session
  host = document.createElement('div'); document.body.append(host)
  app = createApp(CaptureView); app.mount(host)
  await settle()
  return session
}

beforeEach(() => {
  vi.clearAllMocks()
  requests = []
  getUserMedia = vi.fn(() => {
    const request = deferred<MediaStream>(); requests.push(request); return request.promise
  })
  Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia}})
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {configurable: true, get() {return this.srcObject ? 640 : 0}})
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {configurable: true, get() {return this.srcObject ? 480 : 0}})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage: vi.fn()} as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['synthetic jpeg'], {type: 'image/jpeg'})))
  mocks.route.query = reactive({})
  mocks.requiredGps=false
  mocks.mediaIntent.mockResolvedValue(undefined)
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{
    query:vi.fn(async()=>({state:'granted',onchange:null})),
  }})
  mocks.policies.mockResolvedValue([])
  mocks.server.mockResolvedValue({items: []})
  mocks.binding.mockResolvedValue({assignmentId: 'assignment-a', policyRevision: 1})
  mocks.capture.mockResolvedValue({photoId: 'photo-fixture'})
  mocks.allowedMedia = ['photo']
  mocks.privateCache.mockResolvedValue(null)
  mocks.verifyPolicy.mockResolvedValue(undefined)
  mocks.privateScope.mockImplementation((row: {privateRevision?: number}) => 'scope-' + (row.privateRevision ?? 1))
})
afterEach(async () => {
  app?.unmount(); app = undefined
  for (const request of requests) request.resolve(media().stream)
  await settle()
  host?.remove(); activeSession.value = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('private instructions and hardware lifecycle',()=>{
  const policy={assignmentId:'assignment-a',ownerAccountId:'owner-a',policyRevision:1,privateRevision:2}
  const privateText={version:2,title:'Private title',instructions:'Common instructions',
    photoInstructions:'Photo framing',videoInstructions:'Video motion',audioInstructions:'Audio notes'}
  function prepare(){
    mocks.allowedMedia=['photo','video','audio']
    mocks.route.query={assignmentId:policy.assignmentId}
    mocks.policies.mockResolvedValue([policy])
  }
  it.each(['video','audio','stop'] as const)
  ('finishes an in-flight verified private decrypt after %s changes camera tracks',async action=>{
    prepare()
    const cached=deferred<typeof privateText>()
    mocks.privateCache.mockReturnValue(cached.promise)
    await mount()
    expect(mocks.verifyPolicy).toHaveBeenCalledWith(policy,true)
    expect(mocks.privateCache).toHaveBeenCalled()
    if(action==='stop')button('Отключить').click()
    else{
      const mode=host.querySelector<HTMLSelectElement>('#camera-mode')!
      mode.value=action;mode.dispatchEvent(new Event('change',{bubbles:true}))
    }
    await settle()
    cached.resolve(privateText);await settle()
    expect(host.querySelector('[data-testid="camera-media-instruction"]')?.textContent)
      .toContain(action==='video'?'Video motion':action==='audio'?'Audio notes':'Photo framing')
  })
  it.each(['account','device','key'] as const)
  ('rejects a previous identity private decrypt after a real %s change',async field=>{
    prepare()
    const cached=deferred<typeof privateText>()
    const original=identity()
    mocks.privateCache.mockImplementation(()=>activeSession.value===original?cached.promise:Promise.resolve(null))
    await mount(original)
    expect(mocks.privateCache).toHaveBeenCalled()
    const changed={...original,device:{...original.device},pkg:{...original.pkg}}
    if(field==='account')changed.accountId=changed.pkg.accountId='account-b'
    else if(field==='device')changed.deviceId=changed.device.deviceId='device-b'
    else changed.device.encryptionKey={} as CryptoKey
    activeSession.value=changed
    await settle();cached.resolve(privateText);await settle()
    expect(host.querySelector('[data-testid="camera-media-instruction"]')).toBeNull()
    expect(host.textContent).not.toContain('Photo framing')
  })
})

describe('P1-14 MediaRecorder cancellation and plaintext safety',()=>{
  it('stops microphone and drops unsaved parts when the account changes during audio recording',async()=>{
    class FakeRecorder{
      static isTypeSupported(_mime:string){return true}
      state:'inactive'|'recording'='inactive'
      ondataavailable:((event:{data:Blob})=>void)|null=null
      onstop:(()=>void)|null=null
      onerror:(()=>void)|null=null
      stopCount=0
      constructor(_stream:MediaStream,_options:{mimeType:string}){}
      start(){this.state='recording' as const}
      stop(){this.state='inactive' as const;this.stopCount++;this.onstop?.()}
    }
    const created:FakeRecorder[]=[]
    class RecorderFactory extends FakeRecorder{
      constructor(stream:MediaStream,options:{mimeType:string}){
        super(stream,options)
        created.push(this)
      }
    }
    vi.stubGlobal('MediaRecorder',RecorderFactory)
    const session=await mount()
    const original=media();requests[0]!.resolve(original.stream);await settle()
    const mode=host.querySelector<HTMLSelectElement>('#camera-mode')!
    mode.value='audio'
    mode.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    expect(original.track.stop).toHaveBeenCalledTimes(1)
    expect(requests.length).toBe(2)
    const microphone=media();requests[1]!.resolve(microphone.stream);await settle()
    expect(getUserMedia).toHaveBeenLastCalledWith({audio:true,video:false})
    button('Начать запись аудио').click();await settle()
    expect(created).toHaveLength(1)
    expect(created[0]!.state).toBe('recording')
    // Simulate parts still present in browser RAM; they must never be
    // durable or assigned to a subsequent identity.
    created[0]!.ondataavailable?.({data:new Blob([new Uint8Array(256)])})
    activeSession.value={
      ...session,accountId:'account-changed',
      pkg:{...session.pkg,accountId:'account-changed'},
    }
    await settle()
    expect(created[0]!.stopCount).toBe(1)
    expect(microphone.track.stop).toHaveBeenCalledTimes(1)
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="camera-recording-status"]')).toBeNull()
  })
})

describe('camera session ownership and async permission lifecycle', () => {
  it('attaches late permission after online hydration without another request', async () => {
    const session = await mount()
    activeSession.value = {...session, online: true}
    await settle()
    const opened = media(); requests[0]!.resolve(opened.stream)
    await settle()
    expect(host.querySelector('video')!.srcObject).toBe(opened.stream)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(opened.track.stop).not.toHaveBeenCalled()
  })
  it('keeps an active stream across equivalent Session and package objects', async () => {
    const session = await mount()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    activeSession.value = {...session, online: true, device: {...session.device}, pkg: {...session.pkg}}
    await settle()
    expect(host.querySelector('video')!.srcObject).toBe(opened.stream)
    expect(opened.track.stop).not.toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
  it('serializes real account switches while permission is pending and stops the old result', async () => {
    const session = await mount()
    activeSession.value = {...session, accountId: 'account-b', pkg: {...session.pkg, accountId: 'account-b'}}
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    const old = media(); requests[0]!.resolve(old.stream); await settle()
    expect(old.track.stop).toHaveBeenCalledTimes(1)
    expect(host.querySelector('video')!.srcObject).not.toBe(old.stream)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    const current = media(); requests[1]!.resolve(current.stream); await settle()
    expect(host.querySelector('video')!.srcObject).toBe(current.stream)
  })
  it.each(['accountId', 'deviceId', 'deviceSpki', 'deviceKey', 'encryptionKey', 'accountPkcs8', 'akek', 'revision', 'signingKeyId', 'wrappingKeyId', 'accountSpki'] as const)
  ('immediately detaches an active stream when %s changes', async field => {
    const session = await mount()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    const next = {...session, device: {...session.device}, pkg: {...session.pkg}}
    if (field === 'accountId') next.accountId = 'account-b'
    else if (field === 'deviceId') next.deviceId = 'device-b'
    else if (field === 'deviceKey' || field === 'encryptionKey') next.device[field] = {} as CryptoKey
    else if (field === 'deviceSpki') next.device.deviceSpki = 'new-device-public'
    else if (field === 'revision') next.pkg = {...next.pkg, revision: 2}
    else next.pkg = {...next.pkg, [field]: 'changed-fixture'}
    activeSession.value = next
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
    expect(host.querySelector('video')!.srcObject).toBeNull()
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
  it('invalidates an old permission across logout and return to the same identity', async () => {
    const session = await mount()
    activeSession.value = null
    activeSession.value = session
    await settle()
    const old = media(); requests[0]!.resolve(old.stream); await settle()
    expect(old.track.stop).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(host.querySelector('video')!.srcObject).not.toBe(old.stream)
  })
  it('stops a permission result after leaving the screen without restarting', async () => {
    await mount()
    app!.unmount(); app = undefined
    const late = media(); requests[0]!.resolve(late.stream); await settle()
    expect(late.track.stop).toHaveBeenCalledTimes(1)
    expect(play).not.toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
  it('shows denial without automatic retry, then accepts an explicit retry', async () => {
    const session = await mount()
    requests[0]!.reject(new Error('camera denied')); await settle()
    expect(host.querySelector('[role=alert]')!.textContent).toContain('camera denied')
    activeSession.value = {...session, online: true}; await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    button('Включить камеру').click(); await settle()
    const retry = media(); requests[1]!.resolve(retry.stream); await settle()
    expect(host.querySelector('video')!.srcObject).toBe(retry.stream)
    expect(host.querySelector('[role=alert]')).toBeNull()
  })
  it('cancels pending start on Stop and never reopens from hydration or a late result', async () => {
    const session = await mount()
    button('Отключить').click()
    activeSession.value = {...session, online: true}; await settle()
    const late = media(); requests[0]!.resolve(late.stream); await settle()
    expect(late.track.stop).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(host.querySelector('video')!.srcObject).toBeNull()
  })
  it('never opens duplicate streams for repeated start/hydration notifications', async () => {
    const session = await mount()
    for (let i = 0; i < 4; i++) {
      button('Включить камеру').click()
      activeSession.value = {...session, online: i % 2 === 0}
    }
    await settle()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(host.querySelector('video')!.srcObject).toBe(opened.stream)
  })
  it('requests GPS only by explicit action and passes private fields to encryption',async()=>{
    const coordinates={
      latitude:41.647849,longitude:41.639411,accuracy:6,
    }
    const getCurrentPosition=vi.fn((success:PositionCallback)=>{
      success({coords:coordinates,timestamp:Date.now()} as GeolocationPosition)
    })
    Object.defineProperty(navigator,'geolocation',{
      configurable:true,value:{getCurrentPosition},
    })
    await mount()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    const camera=media();requests[0]!.resolve(camera.stream);await settle()
    const cat=host.querySelector<HTMLInputElement>('#camera-category')!
    cat.value='Репортаж';cat.dispatchEvent(new Event('input',{bubbles:true}))
    const description=host.querySelector<HTMLTextAreaElement>('#camera-description')!
    description.value='CONFIDENTIAL-CATEGORY-GPS'
    description.dispatchEvent(new Event('input',{bubbles:true}))
    await settle()
    button('Получить GPS').click();await settle()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('GPS получен')
    button('Сделать снимок').click();await settle()
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.any(Blob),undefined,{
        category:'Репортаж',description:'CONFIDENTIAL-CATEGORY-GPS',tags:[],
        gps:expect.objectContaining({
          latitude:41.647849,longitude:41.639411,accuracyMeters:6,
        }),
      },expect.any(Function))
  })
  it('discards a late GPS result after a genuine identity switch',async()=>{
    let deliver!:PositionCallback
    const getCurrentPosition=vi.fn((success:PositionCallback)=>{deliver=success})
    Object.defineProperty(navigator,'geolocation',{
      configurable:true,value:{getCurrentPosition},
    })
    const session=await mount()
    const opened=media();requests[0]!.resolve(opened.stream);await settle()
    button('Получить GPS').click();await settle()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    activeSession.value={...session,accountId:'account-b'}
    await settle()
    deliver({
      coords:{latitude:41.65,longitude:41.64,accuracy:9},
      timestamp:Date.now(),
    } as GeolocationPosition)
    await settle()
    expect(host.textContent).not.toContain('GPS получен')
    expect(host.querySelector<HTMLInputElement>('#camera-category')?.value).toBe('')
    expect(host.querySelector<HTMLTextAreaElement>('#camera-description')?.value).toBe('')
  })
  it('drops a frame if identity changes while JPEG encoding is pending', async () => {
    const session = await mount()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    let complete!: BlobCallback
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => {complete = callback})
    button('Сделать снимок').click(); await settle()
    activeSession.value = {...session, accountId: 'account-b'}
    complete(new Blob(['old-account-frame'], {type: 'image/jpeg'})); await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
  })
  it('stops tracks when leaving while video.play is pending', async () => {
    const playing = deferred<void>()
    play.mockReturnValueOnce(playing.promise)
    await mount()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    app!.unmount(); app = undefined
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
    playing.resolve(); await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
  })
  it('ignores a stale play rejection and starts only the new identity', async () => {
    const playing = deferred<void>()
    play.mockReturnValueOnce(playing.promise)
    const session = await mount()
    const old = media(); requests[0]!.resolve(old.stream); await settle()
    activeSession.value = {...session, accountId: 'account-b'}
    expect(old.track.stop).toHaveBeenCalledTimes(1)
    playing.reject(new Error('stale play failure')); await settle()
    const current = media(); requests[1]!.resolve(current.stream); await settle()
    expect(host.querySelector('video')!.srcObject).toBe(current.stream)
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
  it('does not store an old frame when identity changes during signed policy binding', async () => {
    const binding = deferred<unknown>()
    mocks.policies.mockResolvedValue([{assignmentId: 'assignment-a', policyRevision: 1}])
    mocks.binding.mockReturnValueOnce(binding.promise)
    mocks.route.query = {assignmentId: 'assignment-a'}
    const session = await mount()
    const opened = media(); requests[0]!.resolve(opened.stream); await settle()
    button('Сделать снимок').click(); await settle()
    expect(mocks.binding).toHaveBeenCalledWith('assignment-a',expect.any(Number),{
      category:'',description:'',gps:null,tags:[],
    })
    activeSession.value = {...session, accountId: 'account-b'}
    binding.resolve({assignmentId: 'assignment-a', policyRevision: 1}); await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it('drops an old account policy response and drains the new account refresh', async () => {
    const oldPolicies = deferred<unknown>()
    mocks.policies.mockReturnValueOnce(oldPolicies.promise)
      .mockResolvedValueOnce([{assignmentId: 'new-assignment', policyRevision: 1}])
    const session = await mount()
    activeSession.value = {...session, accountId: 'account-b'}; await settle()
    oldPolicies.resolve([{assignmentId: 'old-assignment', policyRevision: 1}]); await settle()
    const options = [...host.querySelectorAll('option')].map(option => option.value)
    expect(options).not.toContain('old-assignment')
    expect(options).toContain('new-assignment')
  })
})


describe('Issue #260 GPS consent and capture races',()=>{
  let status:{state:PermissionState;onchange:(()=>void)|null}
  let callbacks:{ok:PositionCallback;fail?:PositionErrorCallback|null}[]
  const point=()=>({coords:{latitude:40.2,longitude:44.4,accuracy:7},timestamp:Date.now()} as GeolocationPosition)
  async function ready(){
    const session=await mount()
    requests[0]!.resolve(media().stream);await settle()
    return session
  }
  async function fix(){
    button('Получить GPS').click();await settle()
    callbacks.at(-1)!.ok(point());await settle()
    expect(host.textContent).toContain('GPS получен')
  }
  function select(id:string,value:string){
    const el=host.querySelector<HTMLSelectElement>(id)!
    el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))
  }
  beforeEach(()=>{
    status={state:'granted',onchange:null};callbacks=[]
    Object.defineProperty(navigator,'permissions',{configurable:true,value:{
      query:vi.fn(async()=>status),
    }})
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition:vi.fn((ok:PositionCallback,fail?:PositionErrorCallback)=>callbacks.push({ok,fail})),
    }})
  })
  it('clears previous fix immediately on repeat; denial never retains old consent, retry succeeds',async()=>{
    await ready();await fix()
    button('Получить GPS').click();await settle()
    expect(host.textContent).not.toContain('GPS получен')
    callbacks[1]!.fail!({code:1,message:'denied'} as GeolocationPositionError)
    await settle()
    button('Сделать снимок').click();await settle()
    expect(mocks.capture.mock.calls[0]![2].gps).toBeNull()
    await fix()
    button('Сделать снимок').click();await settle()
    expect(mocks.capture.mock.calls[1]![2].gps).toMatchObject({latitude:40.2})
  })
  it.each(['denied','prompt'] as const)('removes fix on %s change without another GPS click',async state=>{
    await ready();await fix()
    status.state=state;status.onchange!();await settle()
    expect(status.onchange).toBeNull()
    expect(host.textContent).not.toContain('GPS получен')
    button('Сделать снимок').click();await settle()
    expect(mocks.capture.mock.calls[0]![2].gps).toBeNull()
  })
  it('checks consent at shutter even when the browser delays onchange',async()=>{
    await ready();await fix()
    status.state='denied'
    button('Сделать снимок').click();await settle()
    expect(mocks.capture.mock.calls[0]![2].gps).toBeNull()
    expect(host.textContent).not.toContain('GPS получен')
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
  })
  it.each(['absent','reject','pending'] as const)('fails closed with %s Permissions API at shutter',async kind=>{
    await ready();await fix()
    if(kind==='absent')Object.defineProperty(navigator,'permissions',{configurable:true,value:undefined})
    else vi.mocked(navigator.permissions.query).mockImplementation(()=>kind==='reject'
      ?Promise.reject(Error('unsupported')):new Promise(()=>{}))
    if(kind==='pending')vi.useFakeTimers()
    button('Сделать снимок').click();await settle()
    if(kind==='pending'){await vi.advanceTimersByTimeAsync(1001);await settle()}
    expect(mocks.capture.mock.calls[0]![2].gps).toBeNull()
    vi.useRealTimers()
  })
  it('does not restore GPS from a late callback after permission withdrawal',async()=>{
    await ready()
    button('Получить GPS').click();await settle()
    status.state='denied';status.onchange!();callbacks[0]!.ok(point());await settle()
    expect(host.textContent).not.toContain('GPS получен')
  })
  it.each(['account','device','key','cancel','unmount','assignment','route','mode'] as const)
  ('invalidates pending request on %s, including late delivery',async kind=>{
    mocks.policies.mockResolvedValue([{assignmentId:'assignment-a',policyRevision:1}])
    const session=await ready()
    button('Получить GPS').click();await settle()
    const oldListener=status.onchange
    if(kind==='account')activeSession.value={...session,accountId:'account-b'}
    if(kind==='device')activeSession.value={...session,deviceId:'device-b'}
    if(kind==='key')activeSession.value={...session,pkg:{...session.pkg,akek:'changed'}}
    if(kind==='cancel')button('Убрать GPS').click()
    if(kind==='unmount'){app!.unmount();app=undefined}
    if(kind==='assignment')select('#camera-assignment','assignment-a')
    if(kind==='route')mocks.route.query.assignmentId='assignment-a'
    if(kind==='mode')select('#camera-mode','audio')
    await settle()
    callbacks[0]!.ok(point());oldListener?.();await settle()
    expect(host.textContent).not.toContain('GPS получен')
    expect(status.onchange).toBeNull()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it('keeps a pending fix across equivalent online Session hydration',async()=>{
    const session=await ready()
    button('Получить GPS').click();await settle()
    activeSession.value={...session,online:true,pkg:{...session.pkg},device:{...session.device}}
    await settle();callbacks[0]!.ok(point());await settle()
    expect(host.textContent).toContain('GPS получен')
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
  })
  it('does not resurrect a cancelled attempt after a new successful request',async()=>{
    await ready()
    button('Получить GPS').click();await settle()
    button('Убрать GPS').click();await settle()
    await fix()
    callbacks[0]!.ok({...point(),coords:{...point().coords,latitude:1}})
    await settle();button('Сделать снимок').click();await settle()
    expect(mocks.capture.mock.calls[0]![2].gps.latitude).toBe(40.2)
  })
  it('bounds a native request that never calls back and allows explicit retry',async()=>{
    await ready();vi.useFakeTimers()
    button('Получить GPS').click();await settle()
    await vi.advanceTimersByTimeAsync(12001);await settle()
    expect(button('Получить GPS').disabled).toBe(false)
    expect(host.textContent).not.toContain('GPS получен')
    await fix();vi.useRealTimers()
  })
  it('fails required signed policy after revocation and never calls encrypted outbox',async()=>{
    mocks.requiredGps=true
    mocks.route.query={assignmentId:'assignment-a'}
    mocks.policies.mockResolvedValue([{assignmentId:'assignment-a',policyRevision:2}])
    mocks.binding.mockImplementation(async(_id,_at,fields)=>{
      if(!fields.gps)throw Error('assignment.gps_required')
      return {assignmentId:'assignment-a',policyRevision:2}
    })
    await ready();await fix();status.state='denied'
    button('Сделать снимок').click();await settle()
    expect(host.textContent).toContain('assignment.gps_required')
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })
  it('rechecks GPS after asynchronous Canvas encoding',async()=>{
    let jpeg!:BlobCallback
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(cb=>{jpeg=cb})
    await ready();await fix()
    button('Сделать снимок').click();await settle()
    status.state='denied'
    jpeg(new Blob(['jpeg'],{type:'image/jpeg'}));await settle()
    expect(mocks.capture.mock.calls[0]![2].gps).toBeNull()
  })
  it('cancels captured consent while signed binding is in flight',async()=>{
    const pending=deferred<unknown>()
    mocks.route.query={assignmentId:'assignment-a'}
    mocks.policies.mockResolvedValue([{assignmentId:'assignment-a',policyRevision:2}])
    mocks.binding.mockReturnValue(pending.promise)
    await ready();await fix()
    button('Сделать снимок').click();await settle()
    status.state='denied';status.onchange!()
    pending.resolve({assignmentId:'assignment-a',policyRevision:2});await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it('passes a guard that rejects revocation during P1 encryption',async()=>{
    await ready();await fix()
    mocks.capture.mockImplementation(async(_jpeg,_binding,_fields,assertCurrent)=>{
      status.state='denied';status.onchange!()
      assertCurrent()
      return {photoId:'must-not-be-saved'}
    })
    button('Сделать снимок').click();await settle()
    expect(host.textContent).toContain('camera.gps_consent_changed')
    expect(host.textContent).not.toContain('Зашифровано и сохранено')
  })
  it.each(['video','audio'] as const)('rejects revoked GPS at %s recording finalization',async mode=>{
    let worker!:Recorder
    class Recorder{
      static isTypeSupported(){return true}
      state='inactive'
      ondataavailable:((event:{data:Blob})=>void)|null=null
      onstop:(()=>void)|null=null
      onerror:(()=>void)|null=null
      constructor(){worker=this}
      start(){this.state='recording'}
      stop(){this.state='inactive';this.onstop?.()}
    }
    vi.stubGlobal('MediaRecorder',Recorder)
    await ready();select('#camera-mode',mode);await settle()
    requests[1]!.resolve(media().stream);await settle()
    await fix();vi.useFakeTimers()
    button('Начать запись '+(mode==='video'?'видео':'аудио')).click();await settle()
    expect(worker.state).toBe('recording')
    worker.ondataavailable!({data:new Blob([new Uint8Array(512)])})
    await vi.advanceTimersByTimeAsync(100)
    status.state='denied' // deliberately no event: finalize must query again
    button('Остановить запись').click();await settle()
    expect(host.textContent).toContain('camera.gps_consent_changed')
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it('does not publish P2 JPEG when consent is withdrawn during encryption',async()=>{
    await ready();select('#camera-photo-storage','p2');await settle();await fix()
    mocks.mediaEnqueue.mockImplementation(async(_file,_intent,_fields,assertCurrent)=>{
      status.state='denied';assertCurrent()
      return 'must-not-be-saved'
    })
    button('Сделать снимок').click();await settle()
    expect(host.textContent).toContain('camera.gps_consent_changed')
    expect(host.textContent).not.toContain('P2 JPEG зашифрован')
  })

  it.each(['photo','audio'] as const)('does not sign using a new account during pending %s permission read',async mode=>{
    mocks.allowedMedia=['photo','audio']
    mocks.route.query={assignmentId:'assignment-a'}
    mocks.policies.mockResolvedValue([{assignmentId:'assignment-a',policyRevision:2}])
    const session=await ready()
    if(mode==='audio'){
      select('#camera-mode','audio');await settle()
      requests[1]!.resolve(media().stream);await settle()
    }
    await fix()
    const query=deferred<PermissionStatus>()
    vi.mocked(navigator.permissions.query).mockReturnValue(query.promise)
    button(mode==='photo'?'Сделать снимок':'Начать запись аудио').click();await settle()
    activeSession.value={...session,accountId:'account-b'}
    query.resolve(status as PermissionStatus);await settle()
    expect(mocks.binding).not.toHaveBeenCalled()
    expect(mocks.mediaIntent).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })

  it('refuses a fresh native callback if permission changed silently before delivery',async()=>{
    await ready();button('Получить GPS').click();await settle()
    status.state='denied' // no onchange dispatched yet
    callbacks[0]!.ok(point());await settle()
    expect(host.textContent).not.toContain('GPS получен')
    expect(host.textContent).toContain('camera.gps_permission_required')
  })

})


describe('P2 #206 audio/video duration and encrypted outbox gate', () => {
  class BoundedRecorder {
    static latest:BoundedRecorder|null=null
    static isTypeSupported() {return true}
    options:MediaRecorderOptions
    constructor(_stream:MediaStream,options:MediaRecorderOptions) {
      BoundedRecorder.latest=this
      this.options=options
    }
    state: 'recording'|'inactive' = 'inactive'
    ondataavailable: ((event: {data: Blob}) => void)|null = null
    onstop: (() => void)|null = null
    onerror: (() => void)|null = null
    start() {this.state='recording'}
    stop() {
      this.state='inactive'
      this.ondataavailable?.({data:new Blob([new Uint8Array(512)])})
      this.onstop?.()
    }
  }

  async function openMode(mode:'video'|'audio',bitrate?:number) {
    vi.stubGlobal('MediaRecorder',BoundedRecorder)
    mocks.mediaEnqueue.mockResolvedValue('media-enqueued-after-encryption')
    await mount()
    requests[0]!.resolve(media().stream);await settle()
    const input=host.querySelector<HTMLSelectElement>('#camera-mode')!
    input.value=mode
    input.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    const opened=media()
    requests[1]!.resolve(opened.stream);await settle()
    if(mode==='audio'&&bitrate!==undefined){
      const input=host.querySelector<HTMLSelectElement>('#camera-audio-bitrate')!
      input.value=String(bitrate)
      input.dispatchEvent(new Event('change',{bubbles:true}))
      await settle()
    }
    vi.useFakeTimers()
    button('Начать запись '+(mode==='video'?'видео':'аудио')).click()
    await settle()
    expect(host.querySelector('[data-testid="camera-recording-status"]')).not.toBeNull()
    return opened
  }

  it.each([64000,128000,192000,256000] as const)(
    'supplies chosen audio target %i to native MediaRecorder without claiming output bitrate',async rate=>{
      await openMode('audio',rate)
      expect(BoundedRecorder.latest!.options).toEqual({
        mimeType:'audio/webm',audioBitsPerSecond:rate,
      })
      expect(host.querySelector<HTMLSelectElement>('#camera-audio-bitrate')!.disabled).toBe(true)
      expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    },
  )

  it('does not apply audio-only target setting to video recorder',async()=>{
    await openMode('video')
    expect(BoundedRecorder.latest!.options).toEqual({mimeType:'video/webm'})
  })

  it.each(['video','audio'] as const)('rejects a premature %s Stop before encrypted enqueue', async mode => {
    const opened=await openMode(mode)
    await vi.advanceTimersByTimeAsync(4_999)
    button('Остановить запись').click();await settle()
    expect(host.textContent).toContain('camera.recording_duration_invalid')
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['video',300_000],['audio',3_000_000],
  ] as const)('automatically finishes valid %s at exact bound %i ms',async(mode,maxMs)=>{
    const opened=await openMode(mode)
    expect(host.textContent).toContain('От 5 до '+(maxMs/1000)+' секунд')
    await vi.advanceTimersByTimeAsync(maxMs)
    await settle()
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
    expect(mocks.mediaEnqueue).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Запись зашифрована и сохранена локально')
  })

  it('accepts explicit audio Stop at the exact 5 second lower bound',async()=>{
    await openMode('audio')
    await vi.advanceTimersByTimeAsync(5_000)
    button('Остановить запись').click();await settle()
    expect(mocks.mediaEnqueue).toHaveBeenCalledTimes(1)
  })
  it('stops and discards an audio capture on native microphone hardware interruption',async()=>{
    const opened=await openMode('audio')
    await vi.advanceTimersByTimeAsync(5_200)
    opened.emitEnded()
    await settle()
    expect(host.textContent).toContain('camera.recording_interrupted')
    expect(host.querySelector('[data-testid="camera-recording-status"]')).toBeNull()
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    expect(opened.track.removeEventListener).toHaveBeenCalledWith('ended',expect.any(Function))
    await vi.advanceTimersByTimeAsync(3_000_000)
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })

  it('cancels pending explicit Stop when a microphone ends before the native onstop event',async()=>{
    const opened=await openMode('audio')
    const worker=BoundedRecorder.latest!
    worker.stop=()=>{
      worker.state='inactive'
      worker.ondataavailable?.({data:new Blob([new Uint8Array(512)])})
      setTimeout(()=>worker.onstop?.(),1_000)
    }
    await vi.advanceTimersByTimeAsync(5_000)
    button('Остановить запись').click()
    opened.emitEnded()
    await vi.advanceTimersByTimeAsync(1_000)
    await settle()
    expect(host.textContent).toContain('camera.recording_interrupted')
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })

  it('maps denied native audio permissions without retaining a microphone stream',async()=>{
    await mount()
    requests[0]!.resolve(media().stream)
    await settle()
    const select=host.querySelector<HTMLSelectElement>('#camera-mode')!
    select.value='audio';select.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    requests[1]!.reject(Object.assign(new Error('browser-specific private text'),{
      name:'NotAllowedError',
    }))
    await settle()
    expect(host.textContent).toContain('camera.microphone_permission_denied')
    expect(host.textContent).not.toContain('browser-specific private text')
    expect(host.querySelector<HTMLButtonElement>('[data-testid="camera-start-recording"]')!.disabled)
      .toBe(true)
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })

  it('rejects a permission result containing already-ended microphone hardware',async()=>{
    await mount()
    requests[0]!.resolve(media().stream)
    await settle()
    const select=host.querySelector<HTMLSelectElement>('#camera-mode')!
    select.value='audio';select.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    const opened=media()
    opened.track.stop()
    requests[1]!.resolve(opened.stream)
    await settle()
    expect(host.textContent).toContain('camera.stream_ended')
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
  })

  it('ignores a spontaneous microphone stop even after five seconds of data',async()=>{
    const opened=await openMode('audio')
    await vi.advanceTimersByTimeAsync(5_000)
    BoundedRecorder.latest!.stop() // no explicit Stop or max timer authorization
    await settle()
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    expect(opened.track.stop).toHaveBeenCalledTimes(1)
  })

  it("uses the user stop instant, not a delayed browser onstop callback",async()=>{
    await openMode('audio')
    const recorder=BoundedRecorder.latest!
    recorder.stop=()=>{
      recorder.state='inactive'
      recorder.ondataavailable?.({data:new Blob([new Uint8Array(512)])})
      setTimeout(()=>recorder.onstop?.(),20_000)
    }
    await vi.advanceTimersByTimeAsync(5_000)
    button('Остановить запись').click()
    await vi.advanceTimersByTimeAsync(20_000)
    await settle()
    expect(mocks.mediaEnqueue).toHaveBeenCalledTimes(1)
  })
})
