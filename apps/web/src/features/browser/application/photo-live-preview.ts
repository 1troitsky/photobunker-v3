import {cropGeometry} from './photo-crop'
import type {CropSelection} from './photo-crop'
import {adjustPhotoPixels,validatePhotoAdjustments} from './photo-effects'
import type {PhotoAdjustments} from './photo-effects'
import {drawPhotoShapes} from './photo-shapes'
import type {PhotoShapeMark} from './photo-shapes'
import {drawPhotoStrokes} from './photo-strokes'
import type {PhotoStroke} from './photo-strokes'
import {drawPhotoText} from './photo-text'
import type {PhotoTextMark} from './photo-text'
import {paintPhotoBlackouts} from './photo-blackouts'
import type {PhotoBlackout} from './photo-blackouts'

/** Only a volatile screen-sized canvas. Never a JPEG, outbox file or persisted draft. */
export const LIVE_PREVIEW_MAX_EDGE=1024
export const LIVE_PREVIEW_MAX_PIXELS=1_048_576

export type LivePhotoPreviewLayers=Readonly<{
  text:readonly PhotoTextMark[]
  shapes:readonly PhotoShapeMark[]
  strokes:readonly PhotoStroke[]
  blackouts:readonly PhotoBlackout[]
}>

export type LivePhotoPreviewSize=Readonly<{
  width:number;height:number
  unrotatedWidth:number;unrotatedHeight:number
}>

/** One bounded geometry algorithm for both portrait and landscape. */
export function livePhotoPreviewSize(
  naturalWidth:number,naturalHeight:number,selection:CropSelection,
):LivePhotoPreviewSize{
  const geometry=cropGeometry(naturalWidth,naturalHeight,selection)
  const scale=Math.min(1,
    LIVE_PREVIEW_MAX_EDGE/geometry.outputWidth,
    LIVE_PREVIEW_MAX_EDGE/geometry.outputHeight,
    Math.sqrt(LIVE_PREVIEW_MAX_PIXELS/
      (geometry.outputWidth*geometry.outputHeight)),
  )
  const width=Math.max(1,Math.floor(geometry.outputWidth*scale))
  const height=Math.max(1,Math.floor(geometry.outputHeight*scale))
  return {
    width,height,
    unrotatedWidth:selection.turns%2===0?width:height,
    unrotatedHeight:selection.turns%2===0?height:width,
  }
}

/**
 * Exact photo-crop transform and RGB algorithm at bounded display resolution,
 * with the same compositing order as the explicit JPEG derivative.
 * No toBlob(), object URL, network or IndexedDB side effects.
 */
export function drawLivePhotoPreview(
  source:HTMLImageElement,canvas:HTMLCanvasElement,
  selection:CropSelection,effects:PhotoAdjustments,
  layers:LivePhotoPreviewLayers,
):LivePhotoPreviewSize{
  if(!source.complete||!source.naturalWidth||!source.naturalHeight)
    throw Error('viewer.crop_source_not_ready')
  validatePhotoAdjustments(effects)
  const geometry=cropGeometry(source.naturalWidth,source.naturalHeight,selection)
  const size=livePhotoPreviewSize(
    source.naturalWidth,source.naturalHeight,selection)
  try{
    canvas.width=size.width;canvas.height=size.height
    const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true})
    if(!ctx)throw Error('viewer.crop_canvas_unsupported')
    ctx.save()
    try{
      ctx.translate(size.width/2,size.height/2)
      ctx.rotate(selection.turns*Math.PI/2)
      ctx.drawImage(source,geometry.sx,geometry.sy,geometry.sw,geometry.sh,
        -size.unrotatedWidth/2,-size.unrotatedHeight/2,
        size.unrotatedWidth,size.unrotatedHeight)
    }finally{ctx.restore()}
    if(effects.brightness!==100||effects.contrast!==100
      ||effects.saturation!==100){
      const pixels=ctx.getImageData(0,0,size.width,size.height)
      try{
        adjustPhotoPixels(pixels.data,effects)
        ctx.putImageData(pixels,0,0)
      }finally{pixels.data.fill(0)}
    }
    // Match the actual flattened JPEG layer order. The eraser operates only
    // on the separate transparent paint canvas, never on the source/photo.
    drawPhotoShapes(ctx,size.width,size.height,layers.shapes)
    if(layers.strokes.length){
      const paint=document.createElement('canvas')
      paint.width=size.width;paint.height=size.height
      try{
        const brush=paint.getContext('2d')
        if(!brush)throw Error('viewer.stroke_canvas_unsupported')
        drawPhotoStrokes(brush,size.width,size.height,layers.strokes)
        ctx.drawImage(paint,0,0)
      }finally{paint.width=0;paint.height=0}
    }
    drawPhotoText(ctx,size.width,size.height,layers.text)
    paintPhotoBlackouts(ctx,size.width,size.height,layers.blackouts)
    return size
  }catch(error){
    // Do not display partial pixels after a failed validation/drawing pass.
    canvas.width=0;canvas.height=0
    throw error
  }
}
