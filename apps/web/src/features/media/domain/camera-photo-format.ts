import type {CameraPhotoAspect,CameraPhotoQuality} from '../application/camera-presets'

const ASPECTS:Readonly<Record<CameraPhotoAspect,number>>={
  '1:1':1,'4:3':4/3,'3:2':3/2,'16:9':16/9,
}
const QUALITIES:Readonly<Record<CameraPhotoQuality,{jpeg:number;maxEdge:number}>>={
  // Match the four real resolution tiers of the owner-approved Camera 1.2.
  // Never upscale a smaller native sensor frame to invent detail.
  maximum:{jpeg:.96,maxEdge:1600},
  high:{jpeg:.85,maxEdge:1280},
  medium:{jpeg:.70,maxEdge:960},
  low:{jpeg:.50,maxEdge:640},
}
/**
 * Centered real source crop, followed by a bounded JPEG canvas. Unlike a
 * CSS preview mask, these dimensions determine the actual encrypted photo.
 * Provenance constraints and GPS consent are still checked at the caller.
 */
export function cameraPhotoFormat(
  naturalWidth:number,naturalHeight:number,
  aspect:CameraPhotoAspect,quality:CameraPhotoQuality,
):{
  sx:number;sy:number;sw:number;sh:number
  width:number;height:number;jpegQuality:number
}{
  if(!Number.isSafeInteger(naturalWidth)||!Number.isSafeInteger(naturalHeight)
    ||naturalWidth<2||naturalHeight<2
    ||naturalWidth>16384||naturalHeight>16384)
    throw Error('camera.invalid_frame')
  const target=ASPECTS[aspect],qualityPreset=QUALITIES[quality]
  if(!target||!qualityPreset)throw Error('camera.invalid_photo_preset')
  let sw=naturalWidth,sh=naturalHeight
  if(sw/sh>target)sw=Math.min(sw,Math.floor(sh*target))
  else sh=Math.min(sh,Math.floor(sw/target))
  if(sw<1||sh<1)throw Error('camera.invalid_frame')
  const sx=Math.floor((naturalWidth-sw)/2)
  const sy=Math.floor((naturalHeight-sh)/2)
  const scale=Math.min(1,qualityPreset.maxEdge/Math.max(sw,sh))
  return {sx,sy,sw,sh,width:Math.max(1,Math.round(sw*scale)),
    height:Math.max(1,Math.round(sh*scale)),jpegQuality:qualityPreset.jpeg}
}
