// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, markRaw, nextTick, type App } from 'vue'
import { activeSession, type Session } from '../features/identity/application/session'
import CaptureView from './CaptureView.vue'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), policies: vi.fn(), server: vi.fn(), binding: vi.fn(),
  mediaEnqueue: vi.fn(),
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
  listServerAssignments: mocks.server,
  listVerifiedCapturePolicies: mocks.policies,
  signedCaptureBinding: mocks.binding,
  signedAllowedAssignmentMedia: () => mocks.allowedMedia,
  readCachedPrivateAssignment: mocks.privateCache,
  verifySignedAssignmentPolicy: mocks.verifyPolicy,
  assignmentPrivateCacheScope: mocks.privateScope,
  signedMediaCaptureIntent: vi.fn(),
  signedAdvancedRequirements: () => ({allowedCategories:[],requiredTags:[]}),
  signedPolicyRequirements: () => ({
    requiredCategory:false,descriptionMinLength:0,requiredGps:false,
  }),
  signedMediaRequirements: () => ({
    requiredCategory:false,descriptionMinLength:0,requiredGps:false,
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
  const track = {readyState: 'live', stop: vi.fn(() => {track.readyState = 'ended'})}
  return {stream: markRaw({getTracks: () => [track]}) as unknown as MediaStream, track}
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
  // The default test browser has an explicit, current GPS grant. Tests below
  // independently transition this real permission boundary to denied/unknown.
  Object.defineProperty(navigator, 'permissions', {
    configurable:true,value:{query:vi.fn(async()=>({state:'granted'}))},
  })
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {configurable: true, get() {return this.srcObject ? 640 : 0}})
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {configurable: true, get() {return this.srcObject ? 480 : 0}})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage: vi.fn()} as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['synthetic jpeg'], {type: 'image/jpeg'})))
  mocks.route.query = {}
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
      })
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


describe('P2-SECURITY #260 GPS consent revocation and in-flight privacy',()=>{
  const coords={latitude:38.487329,longitude:-122.893741,accuracy:4.5}

  function permission(state:PermissionState|'unsupported'){
    if(state==='unsupported'){
      Object.defineProperty(navigator,'permissions',{configurable:true,value:undefined})
    }else{
      Object.defineProperty(navigator,'permissions',{
        configurable:true,value:{query:vi.fn(async()=>({state}))},
      })
    }
  }
  function installGeo(get:(success:PositionCallback,error?:PositionErrorCallback)=>void){
    Object.defineProperty(navigator,'geolocation',{
      configurable:true,value:{getCurrentPosition:vi.fn(get)},
    })
  }
  async function opened(){
    const camera=media();requests[0]!.resolve(camera.stream);await settle()
    return camera
  }
  it('invalidates the previous GPS fix immediately on a denied retry',async()=>{
    let calls=0
    installGeo((success,error)=>{
      calls++
      if(calls===1)success({coords,timestamp:Date.now()} as GeolocationPosition)
      else error?.({code:1,message:'Permission denied'} as GeolocationPositionError)
    })
    await mount();await opened()
    button('Получить GPS').click();await settle()
    expect(host.textContent).toContain('GPS получен')
    button('Получить GPS').click();await settle()
    expect(host.textContent).not.toContain('GPS получен')
    expect(host.textContent).toContain('Permission denied')
    button('Сделать снимок').click();await settle()
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Blob),undefined,
      expect.objectContaining({gps:null}))
  })
  it('drops a fresh fix after silent permission revocation before shutter',async()=>{
    installGeo(success=>success({coords,timestamp:Date.now()} as GeolocationPosition))
    await mount();await opened()
    button('Получить GPS').click();await settle()
    expect(host.textContent).toContain('GPS получен')
    permission('denied') // no second GPS click — revoke between fix and shutter
    button('Сделать снимок').click();await settle()
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Blob),undefined,
      expect.objectContaining({gps:null}))
    expect(host.textContent).not.toContain('GPS получен')
    expect(host.textContent).toContain('camera.gps_permission_required')
  })
  it('gates signed requiredGps policy when permission was revoked',async()=>{
    installGeo(success=>success({coords,timestamp:Date.now()} as GeolocationPosition))
    const policy={assignmentId:'assignment-required-gps',policyRevision:2}
    mocks.policies.mockResolvedValue([policy])
    mocks.route.query={assignmentId:policy.assignmentId}
    mocks.binding.mockImplementation(async(_id:string,_when:number,fields:{gps:unknown})=>{
      if(!fields.gps)throw Error('assignment.gps_required')
      return {assignmentId:policy.assignmentId,policyRevision:2}
    })
    await mount();await opened()
    button('Получить GPS').click();await settle()
    expect(host.textContent).toContain('GPS получен')
    permission('denied')
    button('Сделать снимок').click();await settle()
    expect(mocks.binding).toHaveBeenCalledWith(policy.assignmentId,
      expect.any(Number),expect.objectContaining({gps:null}))
    expect(host.textContent).toContain('assignment.gps_required')
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it('rejects unsupported Permissions API rather than silently reusing location',async()=>{
    installGeo(success=>success({coords,timestamp:Date.now()} as GeolocationPosition))
    permission('unsupported')
    await mount();await opened()
    button('Получить GPS').click();await settle()
    expect(host.textContent).not.toContain('GPS получен')
    expect(host.textContent).toContain('camera.gps_permission_required')
    button('Сделать снимок').click();await settle()
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Blob),undefined,
      expect.objectContaining({gps:null}))
  })
  it('does not resurrect a pending GPS callback after changing the assignment',async()=>{
    let resolveGeo!:PositionCallback
    installGeo(success=>{resolveGeo=success})
    const a={assignmentId:'assignment-a',policyRevision:1}
    const b={assignmentId:'assignment-b',policyRevision:2}
    mocks.policies.mockResolvedValue([a,b])
    await mount();await opened()
    button('Получить GPS').click();await settle()
    const selection=host.querySelector<HTMLSelectElement>('#camera-assignment')!
    selection.value=b.assignmentId
    selection.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    resolveGeo({coords,timestamp:Date.now()} as GeolocationPosition)
    await settle()
    expect(host.textContent).not.toContain('GPS получен')
  })
  it('does not attach GPS revoked during asynchronous JPEG encoding',async()=>{
    installGeo(success=>success({coords,timestamp:Date.now()} as GeolocationPosition))
    await mount();await opened()
    button('Получить GPS').click();await settle()
    expect(host.textContent).toContain('GPS получен')
    let finish!:BlobCallback
    vi.mocked(HTMLCanvasElement.prototype.toBlob)
      .mockImplementation(callback=>{finish=callback})
    button('Сделать снимок').click();await settle()
    permission('denied')
    finish(new Blob(['safe synthetic jpeg'],{type:'image/jpeg'}))
    await settle()
    expect(mocks.capture).toHaveBeenCalledWith(expect.any(Blob),undefined,
      expect.objectContaining({gps:null}))
    expect(host.textContent).not.toContain('GPS получен')
  })
})


describe('P2-SECURITY #260 recording consent boundary',()=>{
  it('discards an audio recording when geolocation is revoked after recording started',async()=>{
    const point={latitude:38.487329,longitude:-122.893741,accuracy:4.5}
    Object.defineProperty(navigator,'geolocation',{
      configurable:true,value:{getCurrentPosition:(success:PositionCallback)=>
        success({coords:point,timestamp:Date.now()} as GeolocationPosition)},
    })
    class Recorder{
      static isTypeSupported(){return true}
      state:'inactive'|'recording'='inactive'
      ondataavailable:((event:{data:Blob})=>void)|null=null
      onstop:(()=>void)|null=null
      onerror:(()=>void)|null=null
      start(){this.state='recording'}
      stop(){this.state='inactive';this.onstop?.()}
    }
    const instances:Recorder[]=[]
    class RecorderFactory extends Recorder{
      constructor(_stream:MediaStream,_options:{mimeType:string}){
        super();instances.push(this)
      }
    }
    vi.stubGlobal('MediaRecorder',RecorderFactory)
    await mount()
    const photo=media();requests[0]!.resolve(photo.stream);await settle()
    const mode=host.querySelector<HTMLSelectElement>('#camera-mode')!
    mode.value='audio';mode.dispatchEvent(new Event('change',{bubbles:true}))
    await settle()
    const audio=media();requests[1]!.resolve(audio.stream);await settle()
    button('Получить GPS').click();await settle()
    expect(host.textContent).toContain('GPS получен')
    button('Начать запись аудио').click();await settle()
    expect(instances).toHaveLength(1)
    expect(instances[0]!.state).toBe('recording')
    instances[0]!.ondataavailable?.({data:new Blob([new Uint8Array(256)])})
    Object.defineProperty(navigator,'permissions',{
      configurable:true,value:{query:vi.fn(async()=>({state:'denied'}))},
    })
    button('Остановить запись').click();await settle()
    expect(mocks.mediaEnqueue).not.toHaveBeenCalled()
    expect(host.textContent).toContain('camera.gps_permission_revoked')
    expect(audio.track.stop).toHaveBeenCalledTimes(1)
  })
})
