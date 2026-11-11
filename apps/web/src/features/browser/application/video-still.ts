import {MAX_MEDIA_BYTES} from '../../media/domain/media-crypto'
import {safeDownloadName} from './viewer-navigation'

export type VideoStill={
  blob:Blob
  width:number
  height:number
  timeMs:number
}
const MAX_STILL_DIMENSION=4096
const MAX_STILL_PIXELS=16_777_216

/** A bounded JPEG derivative; never writes to the OS gallery or persistent cache. */
export function stillDimensions(width:number,height:number):{
  width:number;height:number
}{
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
    ||width<=0||height<=0||width>32768||height>32768)
    throw Error('viewer.frame_invalid_dimensions')
  const ratio=Math.min(1,MAX_STILL_DIMENSION/width,
    MAX_STILL_DIMENSION/height,
    Math.sqrt(MAX_STILL_PIXELS/(width*height)))
  return {width:Math.max(1,Math.floor(width*ratio)),
    height:Math.max(1,Math.floor(height*ratio))}
}
export function stillName(source:string,timeMs:number):string{
  if(!Number.isSafeInteger(timeMs)||timeMs<0||timeMs>86_400_000)
    throw Error('viewer.frame_invalid_time')
  const safe=safeDownloadName(source,'video')
    .replace(/\.[^.]+$/,'').slice(0,90)||'video'
  return safe+'-frame-'+timeMs+'ms.jpg'
}

/** Reads only the current decoded, user-viewed frame from an authenticated Blob URL video. */
export async function captureVideoStill(video:HTMLVideoElement):Promise<VideoStill>{
  if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA
    ||!Number.isFinite(video.currentTime)||video.currentTime<0)
    throw Error('viewer.frame_not_ready')
  const timeMs=Math.round(video.currentTime*1000)
  if(!Number.isSafeInteger(timeMs)||timeMs<0||timeMs>86_400_000)
    throw Error('viewer.frame_invalid_time')
  const size=stillDimensions(video.videoWidth,video.videoHeight)
  const canvas=document.createElement('canvas')
  canvas.width=size.width;canvas.height=size.height
  const context=canvas.getContext('2d',{alpha:false})
  if(!context)throw Error('viewer.frame_canvas_unsupported')
  try{
    // Keep canvas plaintext lifetime bounded even if drawImage itself fails
    // (e.g. revoked source, decoder error or disallowed source).
    context.drawImage(video,0,0,size.width,size.height)
    const blob=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(result=>result?resolve(result):reject(
        Error('viewer.frame_encode_failed')),'image/jpeg',0.9)
    })
    if(blob.type!=='image/jpeg'||blob.size<128
      ||blob.size>MAX_MEDIA_BYTES)
      throw Error('viewer.frame_invalid_jpeg')
    return {blob,width:size.width,height:size.height,timeMs}
  }finally{
    context.clearRect(0,0,size.width,size.height)
    canvas.width=0;canvas.height=0
  }
}
