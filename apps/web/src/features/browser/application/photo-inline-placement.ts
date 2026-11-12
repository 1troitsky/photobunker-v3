import {validateTextMarks} from './photo-text'
import type {PhotoTextMark} from './photo-text'

export type InlinePhotoPoint={x:number;y:number}
export type PhotoRect={left:number;top:number;width:number;height:number}

/**
 * Place a draft on the actually rendered JPEG. Never use viewport or
 * document percentages; image letterboxing and mobile scroll are distinct.
 * Text stays within the existing signed JPEG annotation contract (0..85).
 */
export function photoInlinePoint(
  clientX:number,clientY:number,rect:PhotoRect,
):InlinePhotoPoint{
  if(!Number.isFinite(clientX)||!Number.isFinite(clientY)
    ||![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)
    ||rect.width<=0||rect.height<=0)
    throw Error('viewer.text_invalid_canvas')
  const x=Math.round((clientX-rect.left)*100/rect.width)
  const y=Math.round((clientY-rect.top)*100/rect.height)
  return {x:Math.max(0,Math.min(85,x)),y:Math.max(0,Math.min(85,y))}
}

/**
 * No placeholder or blank annotation is created until a user finishes
 * typing. Existing marks are only replaced after the same raster validator
 * as the exported JPEG accepts all fields.
 */
export function prepareInlineText(
  draft:PhotoTextMark,
):PhotoTextMark|null{
  if(!draft.text.trim())return null
  const clean={...draft,text:draft.text.trim()}
  validateTextMarks([clean])
  return clean
}
