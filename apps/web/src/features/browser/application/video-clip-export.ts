import {MAX_MEDIA_BYTES} from '../../media/domain/media-crypto'
import {safeDownloadName} from './viewer-navigation'

/**
 * Gated, in-memory real clip re-encoding. This is NOT an EDL, a copied
 * source Blob, or a fabricated MP4. Caller must own an authenticated,
 * already decrypted browser-local Blob URL and re-check the account before
 * persisting via the independently signed encrypted MediaFile outbox.
 *
 * No gallery writes, downloads, network requests, token or URL persistence.
 * Safari and other browsers without media-element captureStream fail closed.
 */
export type VideoClipMime='video/mp4'|'video/webm'
export type VideoClipRange=Readonly<{
  startMs:number;endMs:number;durationMs:number
}>
export type ExportedVideoClip=Readonly<{
  file:File;blob:Blob;mime:VideoClipMime
  startMs:number;endMs:number;durationMs:number
}>
const MAX_EXPORT_MS=300_000
const MIN_EXPORT_MS=100
const SEEK_TIMEOUT_MS=8000
const LOAD_TIMEOUT_MS=8000
const STOP_TIMEOUT_MS=5000
const MAX_EXPORT_LATENCY_MS=12_000

/** Return an honest browser-reported encoder format, never fake MP4. */
export function chooseVideoClipMime(
  isSupported:(mime:string)=>boolean,
):{mime:VideoClipMime;encoderMime:string}|null{
  const options:ReadonlyArray<readonly [VideoClipMime,string]>=[
    ['video/mp4','video/mp4;codecs="avc1.42E01E,mp4a.40.2"'],
    ['video/mp4','video/mp4'],
    ['video/webm','video/webm;codecs="vp8,opus"'],
    ['video/webm','video/webm;codecs="vp8"'],
    ['video/webm','video/webm'],
  ]
  for(const [mime,encoderMime] of options){
    try{
      if(isSupported(encoderMime))return {mime,encoderMime}
    }catch{/* unsupported browser probe */}
  }
  return null
}

/** Start/end and source duration are video player milliseconds. */
export function validateVideoClipRange(
  sourceDurationMs:number,startMs:number,endMs:number,
):VideoClipRange{
  if(![sourceDurationMs,startMs,endMs].every(Number.isFinite)
    ||!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)
    ||sourceDurationMs<=0||sourceDurationMs>MAX_EXPORT_MS
    ||startMs<0||endMs>sourceDurationMs+2||endMs<=startMs
    ||endMs-startMs<MIN_EXPORT_MS
    ||endMs-startMs>MAX_EXPORT_MS)
    throw Error('viewer.video_clip_invalid_range')
  return {startMs,endMs,durationMs:endMs-startMs}
}

export function videoClipName(
  sourceName:string,range:VideoClipRange,mime:VideoClipMime,
):string{
  if(!/^(video\/mp4|video\/webm)$/.test(mime))
    throw Error('viewer.video_clip_invalid_format')
  const stem=safeDownloadName(sourceName,'video')
    .replace(/\.[^.]+$/,'').slice(0,90)||'video'
  return stem+'-clip-'+range.startMs+'-'+range.endMs+
    (mime==='video/mp4'?'.mp4':'.webm')
}

/** Sniff the ENTIRE result's container declaration, never trust extension. */
export async function verifyVideoClipContainer(
  blob:Blob,expectedMime:VideoClipMime,
):Promise<void>{
  if(blob.size<16||blob.size>MAX_MEDIA_BYTES)
    throw Error('viewer.video_clip_invalid_bytes')
  const mime=blob.type.split(';')[0]?.trim().toLowerCase()
  if(mime!==expectedMime)throw Error('viewer.video_clip_invalid_format')
  const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer())
  const valid=expectedMime==='video/mp4'
    ?bytes[4]===0x66&&bytes[5]===0x74&&bytes[6]===0x79&&bytes[7]===0x70
    :bytes[0]===0x1a&&bytes[1]===0x45
      &&bytes[2]===0xdf&&bytes[3]===0xa3
  if(!valid)throw Error('viewer.video_clip_container_mismatch')
}

/**
 * Waits for a browser video event with a strict timeout and cancellation.
 * No source is published to the network or OS gallery.
 */
function waitVideoEvent(
  video:HTMLVideoElement,
  event:'loadedmetadata'|'seeked',
  timeoutMs:number,
  signal:AbortSignal|undefined,
):Promise<void>{
  return new Promise((resolve,reject)=>{
    let settled=false
    const finish=(err?:Error)=>{
      if(settled)return
      settled=true
      clearTimeout(timer)
      video.removeEventListener(event,ready)
      video.removeEventListener('error',failed)
      signal?.removeEventListener('abort',aborted)
      if(err)reject(err);else resolve()
    }
    const ready=()=>finish()
    const failed=()=>finish(Error('viewer.video_clip_source_error'))
    const aborted=()=>finish(Error('viewer.video_clip_aborted'))
    const timer=setTimeout(()=>finish(Error('viewer.video_clip_timeout')),timeoutMs)
    video.addEventListener(event,ready,{once:true})
    video.addEventListener('error',failed,{once:true})
    signal?.addEventListener('abort',aborted,{once:true})
    if(signal?.aborted)aborted()
  })
}

type CapturableVideo=HTMLVideoElement & {
  captureStream?:()=>MediaStream
  mozCaptureStream?:()=>MediaStream
}

/** Actual bounded in-memory encoding; caller owns encrypted persistence. */
export async function exportRealVideoClip(args:{
  source:HTMLVideoElement
  sourceName:string
  startMs:number
  endMs:number
  signal?:AbortSignal
  assertAuthorized:()=>void
}):Promise<ExportedVideoClip>{
  args.assertAuthorized()
  if(args.signal?.aborted)throw Error('viewer.video_clip_aborted')
  const original=args.source.currentSrc||args.source.src
  if(!original.startsWith('blob:'))
    throw Error('viewer.video_clip_local_source_required')
  const range=validateVideoClipRange(
    args.source.duration*1000,args.startMs,args.endMs)
  if(typeof MediaRecorder==='undefined'
    ||typeof MediaRecorder.isTypeSupported!=='function')
    throw Error('viewer.video_clip_unsupported')
  const selected=chooseVideoClipMime(type=>MediaRecorder.isTypeSupported(type))
  if(!selected)throw Error('viewer.video_clip_unsupported')
  const source=document.createElement('video') as CapturableVideo
  source.preload='auto'
  source.playsInline=true
  // A clone keeps all video UI playback and trim sliders untouched.
  source.muted=true
  source.src=original

  let stream:MediaStream|null=null
  let recorder:MediaRecorder|null=null
  const {signal,assertAuthorized}=args
  try{
    const loaded=waitVideoEvent(source,'loadedmetadata',LOAD_TIMEOUT_MS,signal)
    source.load()
    await loaded
    assertAuthorized()
    if(!Number.isFinite(source.duration)
      ||source.duration*1000<range.endMs-2)
      throw Error('viewer.video_clip_source_changed')

    if(Math.abs(source.currentTime*1000-range.startMs)>50){
      const seeked=waitVideoEvent(source,'seeked',SEEK_TIMEOUT_MS,signal)
      source.currentTime=range.startMs/1000
      await seeked
    }
    assertAuthorized()
    if(signal?.aborted)throw Error('viewer.video_clip_aborted')
    const capture=source.captureStream??source.mozCaptureStream
    if(typeof capture!=='function')
      throw Error('viewer.video_clip_unsupported')
    stream=capture.call(source)
    if(!stream||stream.getVideoTracks().length===0)
      throw Error('viewer.video_clip_unsupported')
    recorder=new MediaRecorder(stream,{mimeType:selected.encoderMime,
      videoBitsPerSecond:2_400_000})
    const mime=recorder.mimeType.split(';')[0]?.trim().toLowerCase()
    if(mime!==selected.mime)
      throw Error('viewer.video_clip_invalid_format')

    const produced=await new Promise<Blob>((resolve,reject)=>{
      let done=false
      let totalBytes=0
      const chunks:Blob[]=[]
      const complete=(error?:Error)=>{
        if(done)return
        done=true
        clearInterval(clock)
        clearTimeout(deadline)
        source.removeEventListener('timeupdate',checkProgress)
        source.removeEventListener('ended',onEnd)
        source.removeEventListener('error',onSourceError)
        signal?.removeEventListener('abort',onAbort)
        source.pause()
        if(recorder?.state!=='inactive'){
          try{recorder?.stop()}catch{/* best effort cleanup */}
        }
        if(error)reject(error)
        else resolve(new Blob(chunks,{type:selected.mime}))
      }
      const stopAtEnd=()=>{
        if(done)return
        try{assertAuthorized()}catch{
          complete(Error('viewer.video_clip_auth_changed'));return
        }
        if(signal?.aborted){
          complete(Error('viewer.video_clip_aborted'));return
        }
        if(source.currentTime*1000>=range.endMs-25){
          // Trigger a flush; only the onstop callback returns the encoded file.
          try{if(recorder?.state==='recording')recorder.stop()}catch{
            complete(Error('viewer.video_clip_encode_failed'))
          }
        }
      }
      const checkProgress=()=>stopAtEnd()
      const onEnd=()=>stopAtEnd()
      const onSourceError=()=>complete(Error('viewer.video_clip_source_error'))
      const onAbort=()=>complete(Error('viewer.video_clip_aborted'))
      const clock=setInterval(stopAtEnd,30)
      const deadline=setTimeout(()=>
        complete(Error('viewer.video_clip_timeout')),
        range.durationMs+MAX_EXPORT_LATENCY_MS)
      source.addEventListener('timeupdate',checkProgress)
      source.addEventListener('ended',onEnd,{once:true})
      source.addEventListener('error',onSourceError,{once:true})
      signal?.addEventListener('abort',onAbort,{once:true})
      recorder!.ondataavailable=(event:BlobEvent)=>{
        if(done)return
        if(!event.data||event.data.size===0)return
        totalBytes+=event.data.size
        if(totalBytes>MAX_MEDIA_BYTES){
          complete(Error('viewer.video_clip_too_large'));return
        }
        chunks.push(event.data)
      }
      recorder!.onerror=()=>complete(Error('viewer.video_clip_encode_failed'))
      recorder!.onstop=()=>{
        if(done)return
        if(totalBytes<16){
          complete(Error('viewer.video_clip_empty'));return
        }
        complete()
      }
      try{
        recorder!.start(250)
        void source.play().catch(()=>
          complete(Error('viewer.video_clip_playback_failed')))
      }catch{
        complete(Error('viewer.video_clip_encode_failed'))
      }
    })

    assertAuthorized()
    if(signal?.aborted)throw Error('viewer.video_clip_aborted')
    await verifyVideoClipContainer(produced,selected.mime)
    assertAuthorized()
    const name=videoClipName(args.sourceName,range,selected.mime)
    const file=new File([produced],name,{type:selected.mime})
    return {blob:produced,file,mime:selected.mime,
      startMs:range.startMs,endMs:range.endMs,
      durationMs:range.durationMs}
  }finally{
    if(recorder?.state==='recording'){
      try{recorder.stop()}catch{/* cleanup */}
    }
    stream?.getTracks().forEach(t=>t.stop())
    source.pause()
    source.removeAttribute('src')
    source.load()
  }
}
