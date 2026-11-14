// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {
  chooseVideoClipMime,exportRealVideoClip,validateVideoClipRange,
  verifyVideoClipContainer,videoClipName,
} from './video-clip-export'

const webm=new Uint8Array([
  0x1a,0x45,0xdf,0xa3,0x9f,0x42,0x86,0x81,
  0x01,0x42,0xf7,0x81,0x01,0x42,0xf2,0x81,0x04,
])
const mp4=new Uint8Array([
  0,0,0,24,0x66,0x74,0x79,0x70,
  0x69,0x73,0x6f,0x6d,0,0,0,0,
])

class TestVideo extends EventTarget{
  currentSrc='blob:https://test.example/authorized-source'
  src=this.currentSrc
  duration=10
  private position=0
  preload='none'
  playsInline=false
  muted=false
  paused=true
  captureStream=()=>({
    getVideoTracks:()=>[{stop:vi.fn()}],
    getTracks:()=>[{stop:vi.fn()}],
  } as unknown as MediaStream)

  get currentTime(){return this.position}
  set currentTime(value:number){
    this.position=value
    queueMicrotask(()=>this.dispatchEvent(new Event('seeked')))
  }
  load(){
    if(this.src)queueMicrotask(()=>
      this.dispatchEvent(new Event('loadedmetadata')))
  }
  play(){
    this.paused=false
    queueMicrotask(()=>{
      this.position=6.01
      this.dispatchEvent(new Event('timeupdate'))
    })
    return Promise.resolve()
  }
  pause(){this.paused=true}
  removeAttribute(name:string){if(name==='src')this.src=''}
}

let encodedType='video/webm'
let output=webm
let created:TestVideo[]=[]
let lastStop=0
class FakeMediaRecorder{
  static isTypeSupported(type:string){return type.startsWith('video/webm')}
  readonly mimeType:string
  state:RecordingState='inactive'
  ondataavailable:((event:BlobEvent)=>void)|null=null
  onerror:(()=>void)|null=null
  onstop:(()=>void)|null=null
  constructor(
    _stream:MediaStream,
    options:{mimeType:string},
  ){
    this.mimeType=options.mimeType
  }
  start(){this.state='recording'}
  stop(){
    if(this.state==='inactive')return
    lastStop++
    this.state='inactive'
    this.ondataavailable?.({data:new Blob([output],{type:encodedType})} as BlobEvent)
    this.onstop?.()
  }
}
beforeEach(()=>{
  created=[]
  lastStop=0
  output=webm
  encodedType='video/webm'
  vi.stubGlobal('MediaRecorder',FakeMediaRecorder)
  const originalCreate=document.createElement.bind(document)
  vi.spyOn(document,'createElement').mockImplementation((name:string,options?:ElementCreationOptions)=>{
    if(name==='video'){
      const result=new TestVideo()
      created.push(result)
      return result as unknown as HTMLVideoElement
    }
    return originalCreate(name,options)
  })
})
afterEach(()=>{
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('P2 #215 real browser video clip encoder gating',()=>{
  it('returns ONLY an actually supported container and never fabricates MP4',()=>{
    const selected=chooseVideoClipMime(mime=>mime==='video/webm')
    expect(selected).toEqual({mime:'video/webm',encoderMime:'video/webm'})
    expect(chooseVideoClipMime(()=>false)).toBeNull()
    expect(chooseVideoClipMime(type=>type==='video/mp4'))
      .toEqual({mime:'video/mp4',encoderMime:'video/mp4'})
    expect(chooseVideoClipMime(()=>{throw Error('probe')})).toBeNull()
  })
  it('bounds source and clip positions before any decoder or codec',()=>{
    expect(validateVideoClipRange(10_000,1000,6000)).toEqual({
      startMs:1000,endMs:6000,durationMs:5000,
    })
    for(const bad of [
      [10_000,-1,7000],[10_000,6000,3000],
      [10_000,0,50],[10_000,0,10_010],
      [300_001,0,10_000],[NaN,0,5000],
      [10_000,0,Infinity],[10_000,1.1,5000],
      [10_000,1000,5000.5],
    ] as const)
      expect(()=>validateVideoClipRange(bad[0],bad[1],bad[2]))
        .toThrow('viewer.video_clip_invalid_range')
  })
  it('uses authenticated private filenames and real container extension',()=>{
    const range=validateVideoClipRange(10_000,1000,6000)
    const webmName=videoClipName('../../private\\\\family.mov',range,'video/webm')
    expect(webmName).toMatch(/^private__family-clip-1000-6000\.webm$/)
    expect(videoClipName('a.mp4',range,'video/mp4')).toBe('a-clip-1000-6000.mp4')
    expect(()=>videoClipName('a.mp4',range,'video/wav' as 'video/webm'))
      .toThrow('viewer.video_clip_invalid_format')
  })
  it('sniffs actual EBML/ftyp magic and refuses fake MIME or huge output',async()=>{
    await expect(verifyVideoClipContainer(
      new Blob([webm],{type:'video/webm'}),'video/webm')).resolves.toBeUndefined()
    await expect(verifyVideoClipContainer(
      new Blob([mp4],{type:'video/mp4'}),'video/mp4')).resolves.toBeUndefined()
    await expect(verifyVideoClipContainer(
      new Blob([webm],{type:'video/mp4'}),'video/mp4'))
      .rejects.toThrow('viewer.video_clip_container_mismatch')
    await expect(verifyVideoClipContainer(
      new Blob([mp4],{type:'video/webm'}),'video/webm'))
      .rejects.toThrow('viewer.video_clip_container_mismatch')
    await expect(verifyVideoClipContainer(
      new Blob([mp4],{type:'video/webm'}),'video/mp4'))
      .rejects.toThrow('viewer.video_clip_invalid_format')
    await expect(verifyVideoClipContainer(
      new Blob([webm.slice(0,5)],{type:'video/webm'}),'video/webm'))
      .rejects.toThrow('viewer.video_clip_invalid_bytes')
  })
  it('encodes a NEW real-byte WebM and leaves source, gallery and cloud untouched',async()=>{
    const source=new TestVideo()
    const assertAuthorized=vi.fn()
    const clip=await exportRealVideoClip({
      source:source as unknown as HTMLVideoElement,
      sourceName:'secret.mp4',startMs:1000,endMs:6000,assertAuthorized,
    })
    expect(clip.mime).toBe('video/webm')
    expect(clip.file).toBeInstanceOf(File)
    expect(clip.file.name).toBe('secret-clip-1000-6000.webm')
    expect(clip.file.type).toBe('video/webm')
    expect(clip.blob.size).toBe(webm.byteLength)
    expect(clip.durationMs).toBe(5000)
    expect(assertAuthorized).toHaveBeenCalled()
    expect(source.currentSrc).toContain('blob:')
    expect(created).toHaveLength(1)
    expect(created[0]?.src).toBe('')
    expect(created[0]?.paused).toBe(true)
    expect(lastStop).toBe(1)
  })
  it('rejects unsupported, cross-origin and revoked input BEFORE decoding',async()=>{
    const source=new TestVideo()
    source.currentSrc='https://remote.invalid/p.mp4'
    await expect(exportRealVideoClip({
      source:source as unknown as HTMLVideoElement,sourceName:'a.mp4',
      startMs:1000,endMs:6000,assertAuthorized:()=>{},
    })).rejects.toThrow('viewer.video_clip_local_source_required')
    expect(created).toHaveLength(0)
    source.currentSrc='blob:https://test.example/authorized'
    vi.stubGlobal('MediaRecorder',undefined)
    await expect(exportRealVideoClip({
      source:source as unknown as HTMLVideoElement,sourceName:'a.mp4',
      startMs:1000,endMs:6000,assertAuthorized:()=>{},
    })).rejects.toThrow('viewer.video_clip_unsupported')
    expect(created).toHaveLength(0)
  })
  it('aborts BEFORE network, decode and OS-output on revoked session',async()=>{
    const aborted=new AbortController()
    aborted.abort()
    await expect(exportRealVideoClip({
      source:new TestVideo() as unknown as HTMLVideoElement,
      sourceName:'x.mp4',startMs:1000,endMs:6000,
      assertAuthorized:()=>{},signal:aborted.signal,
    })).rejects.toThrow('viewer.video_clip_aborted')
    expect(created).toHaveLength(0)
    await expect(exportRealVideoClip({
      source:new TestVideo() as unknown as HTMLVideoElement,
      sourceName:'x.mp4',startMs:1000,endMs:6000,
      assertAuthorized:()=>{throw Error('identity.account_changed')},
    })).rejects.toThrow('identity.account_changed')
  })
  it('fails closed if the returned actual container is not what the MIME says',async()=>{
    encodedType='video/webm'
    output=mp4
    await expect(exportRealVideoClip({
      source:new TestVideo() as unknown as HTMLVideoElement,
      sourceName:'x.mp4',startMs:1000,endMs:6000,assertAuthorized:()=>{},
    })).rejects.toThrow('viewer.video_clip_container_mismatch')
    expect(created[0]?.src).toBe('')
  })
})
