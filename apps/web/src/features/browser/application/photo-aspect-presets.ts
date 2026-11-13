import {cropGeometry} from './photo-crop'
import type {CropSelection} from './photo-crop'

export type PhotoAspectPreset='original'|'1:1'|'4:3'|'16:9'
const RATIOS:Record<Exclude<PhotoAspectPreset,'original'>,number>={
  '1:1':1,'4:3':4/3,'16:9':16/9,
}
const TOLERANCE=0.004

/**
 * Produces INTEGER percentage crops compatible with the existing verified
 * JPEG cropGeometry/cropPhoto raster pipeline. Scores ACTUAL pixel bounds,
 * not a CSS aspect ratio. Re-centered on the user's current focal point.
 * After 90/270° rotation, the chosen source crop ratio is transposed.
 */
export function choosePhotoAspect(
  naturalWidth:number,naturalHeight:number,
  current:CropSelection,preset:PhotoAspectPreset,
):CropSelection{
  // Also verifies natural dimensions and current region independently.
  cropGeometry(naturalWidth,naturalHeight,current)
  if(preset==='original')
    return {left:0,top:0,width:100,height:100,turns:current.turns}
  const target=RATIOS[preset]
  const rotated=current.turns%2!==0
  const centerX=current.left+current.width/2
  const centerY=current.top+current.height/2
  let best:CropSelection|null=null
  let bestError=Infinity,bestArea=-1
  for(let width=10;width<=100;width++){
    const left=Math.max(0,Math.min(100-width,
      Math.round(centerX-width/2)))
    const leftPixels=Math.floor(naturalWidth*left/100)
    const rightPixels=Math.min(naturalWidth,
      Math.ceil(naturalWidth*(left+width)/100))
    const pixelsW=rightPixels-leftPixels
    for(let height=10;height<=100;height++){
      const top=Math.max(0,Math.min(100-height,
        Math.round(centerY-height/2)))
      const topPixels=Math.floor(naturalHeight*top/100)
      const bottomPixels=Math.min(naturalHeight,
        Math.ceil(naturalHeight*(top+height)/100))
      const pixelsH=bottomPixels-topPixels
      if(pixelsW<=0||pixelsH<=0)continue
      const actual=rotated?pixelsH/pixelsW:pixelsW/pixelsH
      const error=Math.abs(actual-target)/target
      const area=pixelsW*pixelsH
      const close=error<=TOLERANCE
      const previousClose=bestError<=TOLERANCE
      if(!best||(close&&!previousClose)
        ||(close&&previousClose&&(area>bestArea
          ||area===bestArea&&error<bestError))
        ||(!close&&!previousClose&&(error<bestError
          ||error===bestError&&area>bestArea))){
        best={left,top,width,height,turns:current.turns}
        bestError=error;bestArea=area
      }
    }
  }
  if(!best)throw Error('viewer.crop_preset_unavailable')
  // Guaranteed compatible with the current authenticated crop engine.
  cropGeometry(naturalWidth,naturalHeight,best)
  return best
}
