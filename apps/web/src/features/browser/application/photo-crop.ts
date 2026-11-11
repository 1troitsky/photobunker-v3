import {MAX_MEDIA_BYTES} from '../../media/domain/media-crypto'
import {safeDownloadName} from './viewer-navigation'
import {
  adjustPhotoPixels,validatePhotoAdjustments,DEFAULT_PHOTO_ADJUSTMENTS,
} from './photo-effects'
import type {PhotoAdjustments} from './photo-effects'

export type CropSelection={
  left:number;top:number;width:number;height:number;turns:0|1|2|3
}
export type CropGeometry={
  sx:number;sy:number;sw:number;sh:number
  drawnWidth:number;drawnHeight:number
  outputWidth:number;outputHeight:number
}
export type CroppedPhoto={blob:Blob;width:number;height:number}

const MAX_PIXELS=16_777_216
const MAX_DIMENSION=4096
export function cropGeometry(
  naturalWidth:number,naturalHeight:number,region:CropSelection,
):CropGeometry{
  if(!Number.isSafeInteger(naturalWidth)||!Number.isSafeInteger(naturalHeight)
    ||naturalWidth<1||naturalHeight<1
    ||naturalWidth>32768||naturalHeight>32768
    ||![0,1,2,3].includes(region.turns)
    ||![region.left,region.top,region.width,region.height]
      .every(v=>Number.isSafeInteger(v))
    ||region.left<0||region.top<0||region.width<10||region.height<10
    ||region.left+region.width>100||region.top+region.height>100)
    throw Error('viewer.crop_invalid_region')
  const sx=Math.floor(naturalWidth*region.left/100)
  const sy=Math.floor(naturalHeight*region.top/100)
  const right=Math.min(naturalWidth,
    Math.ceil(naturalWidth*(region.left+region.width)/100))
  const bottom=Math.min(naturalHeight,
    Math.ceil(naturalHeight*(region.top+region.height)/100))
  const sw=right-sx,sh=bottom-sy
  if(sw<1||sh<1)throw Error('viewer.crop_empty')
  const scale=Math.min(1,MAX_DIMENSION/sw,MAX_DIMENSION/sh,
    Math.sqrt(MAX_PIXELS/(sw*sh)))
  const drawnWidth=Math.max(1,Math.floor(sw*scale))
  const drawnHeight=Math.max(1,Math.floor(sh*scale))
  const rotated=region.turns%2===1
  return {
    sx,sy,sw,sh,drawnWidth,drawnHeight,
    outputWidth:rotated?drawnHeight:drawnWidth,
    outputHeight:rotated?drawnWidth:drawnHeight,
  }
}
export function cropFileName(
  source:string,region:CropSelection,
  effects:PhotoAdjustments=DEFAULT_PHOTO_ADJUSTMENTS,
):string{
  // No private GPS, notes or metadata are embedded in an output name.
  cropGeometry(100,100,region) // canonical bounds check, no pixel allocation
  validatePhotoAdjustments(effects)
  const suffix=effects.brightness===100&&effects.contrast===100
    &&effects.saturation===100?''
    :'-fx-'+effects.brightness+'-'+effects.contrast+'-'+effects.saturation
  const stem=safeDownloadName(source,'photo')
    .replace(/\.[^.]+$/,'').slice(0,80)||'photo'
  return stem+'-crop-'+region.left+'-'+region.top+'-'+region.width
    +'-'+region.height+'-r'+(region.turns*90)+suffix+'.jpg'
}

/** Operates only on an already authenticated and locally decoded Blob URL image. */
export async function cropPhoto(
  element:HTMLImageElement,region:CropSelection,
  effects:PhotoAdjustments=DEFAULT_PHOTO_ADJUSTMENTS,
):Promise<CroppedPhoto>{
  if(!element.complete||!element.naturalWidth||!element.naturalHeight)
    throw Error('viewer.crop_source_not_ready')
  const g=cropGeometry(element.naturalWidth,element.naturalHeight,region)
  validatePhotoAdjustments(effects)
  const canvas=document.createElement('canvas')
  canvas.width=g.outputWidth;canvas.height=g.outputHeight
  const ctx=canvas.getContext('2d',{alpha:false})
  if(!ctx)throw Error('viewer.crop_canvas_unsupported')
  try{
    ctx.translate(g.outputWidth/2,g.outputHeight/2)
    ctx.rotate(region.turns*Math.PI/2)
    ctx.drawImage(element,g.sx,g.sy,g.sw,g.sh,
      -g.drawnWidth/2,-g.drawnHeight/2,g.drawnWidth,g.drawnHeight)
    if(effects.brightness!==100||effects.contrast!==100
      ||effects.saturation!==100){
      const pixels=ctx.getImageData(0,0,g.outputWidth,g.outputHeight)
      adjustPhotoPixels(pixels.data,effects)
      ctx.putImageData(pixels,0,0)
      pixels.data.fill(0)
    }
    const blob=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(result=>result?resolve(result):reject(
        Error('viewer.crop_encode_failed')),'image/jpeg',0.9)
    })
    if(blob.type!=='image/jpeg'||blob.size<128||blob.size>MAX_MEDIA_BYTES)
      throw Error('viewer.crop_invalid_jpeg')
    return {blob,width:g.outputWidth,height:g.outputHeight}
  }finally{
    ctx.clearRect(0,0,g.outputWidth,g.outputHeight)
    canvas.width=0;canvas.height=0
  }
}
