import {canExportPhotoCanvas} from './photo-export-budget'
/** Opaque black rectangles for a separate personal JPEG derivative only. */
export type PhotoBlackout=Readonly<{
  id:string;x:number;y:number;width:number;height:number
}>
export const MAX_PHOTO_BLACKOUTS=12

export function validatePhotoBlackouts(items:readonly PhotoBlackout[]):void{
  if(!Array.isArray(items)||items.length>MAX_PHOTO_BLACKOUTS)
    throw Error('viewer.blackout_invalid_count')
  const ids=new Set<string>()
  for(const m of items){
    if(!m||typeof m!=='object'
      ||Object.keys(m).sort().join('|')!=='height|id|width|x|y'
      ||typeof m.id!=='string'
      ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(m.id)
      ||ids.has(m.id)
      ||![m.x,m.y,m.width,m.height].every(Number.isSafeInteger)
      ||m.x<0||m.y<0||m.x>95||m.y>95
      ||m.width<5||m.height<5||m.x+m.width>100
      ||m.y+m.height>100)
      throw Error('viewer.blackout_invalid_region')
    ids.add(m.id)
  }
}

/**
 * Paint masks LAST, after all text, shapes and strokes: prior pixels are
 * physically replaced before JPEG encoding; not a CSS or blur-only effect.
 * This DOES NOT revoke the original or authorize safe/public publication.
 */
export function paintPhotoBlackouts(
  ctx:CanvasRenderingContext2D,width:number,height:number,
  items:readonly PhotoBlackout[],
):void{
  validatePhotoBlackouts(items)
  if(!canExportPhotoCanvas(width,height))
    throw Error('viewer.blackout_invalid_canvas')
  ctx.save()
  try{
    ctx.fillStyle='#000000'
    for(const m of items){
      const left=Math.floor(m.x*width/100)
      const top=Math.floor(m.y*height/100)
      const right=Math.ceil((m.x+m.width)*width/100)
      const bottom=Math.ceil((m.y+m.height)*height/100)
      ctx.fillRect(left,top,right-left,bottom-top)
    }
  }finally{
    ctx.restore()
  }
}
