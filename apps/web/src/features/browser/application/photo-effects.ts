export type PhotoAdjustments=Readonly<{
  brightness:number;contrast:number;saturation:number
}>

export const DEFAULT_PHOTO_ADJUSTMENTS:PhotoAdjustments={
  brightness:100,contrast:100,saturation:100,
}
export function validatePhotoAdjustments(
  adjustments:PhotoAdjustments,
):PhotoAdjustments{
  if(!adjustments||!Object.values(adjustments).every(
    value=>Number.isSafeInteger(value)&&value>=0&&value<=200,
  )||Object.keys(adjustments).sort().join('|')!=='brightness|contrast|saturation')
    throw Error('viewer.photo_adjustment_invalid')
  return adjustments
}

/**
 * Apply deterministic RGB adjustment to an already cropped, locally decoded
 * Canvas ImageData buffer. No external codec, shaders, telemetry or persistence.
 * Alpha is unchanged and image pixels are clipped to 8-bit output.
 */
export function adjustPhotoPixels(
  pixels:Uint8ClampedArray,
  adjustments:PhotoAdjustments,
):void{
  validatePhotoAdjustments(adjustments)
  if(pixels.length%4!==0)throw Error('viewer.photo_pixels_invalid')
  if(adjustments.brightness===100
    &&adjustments.contrast===100
    &&adjustments.saturation===100)return

  const bright=adjustments.brightness/100
  const contrast=adjustments.contrast/100
  const saturation=adjustments.saturation/100
  for(let i=0;i<pixels.length;i+=4){
    const r=(pixels[i]??0)*bright
    const g=(pixels[i+1]??0)*bright
    const b=(pixels[i+2]??0)*bright
    const rr=(r-128)*contrast+128
    const gg=(g-128)*contrast+128
    const bb=(b-128)*contrast+128
    const luminance=0.2126*rr+0.7152*gg+0.0722*bb
    pixels[i]=luminance+(rr-luminance)*saturation
    pixels[i+1]=luminance+(gg-luminance)*saturation
    pixels[i+2]=luminance+(bb-luminance)*saturation
  }
}
