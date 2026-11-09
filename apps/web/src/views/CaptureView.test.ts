// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, markRaw, nextTick, type App } from 'vue'
import { activeSession, type Session } from '../features/identity/application/session'
import CaptureView from './CaptureView.vue'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), policies: vi.fn(), server: vi.fn(), binding: vi.fn(),
  route: {query: {} as Record<string, string>},
}))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  RouterLink: {template: '<a><slot /></a>'},
}))
vi.mock('../features/photo-sync/application/p1-photo', () => ({captureEncrypted: mocks.capture}))
vi.mock('../features/assignments/application/assignment-outbox', () => ({
  listServerAssignments: mocks.server,
  listVerifiedCapturePolicies: mocks.policies,
  signedCaptureBinding: mocks.binding,
  signedPolicyRequirements: () => ({
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
})
afterEach(async () => {
  app?.unmount(); app = undefined
  for (const request of requests) request.resolve(media().stream)
  await settle()
  host?.remove(); activeSession.value = null
  vi.restoreAllMocks()
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
        category:'Репортаж',description:'CONFIDENTIAL-CATEGORY-GPS',
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
      category:'',description:'',gps:null,
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
