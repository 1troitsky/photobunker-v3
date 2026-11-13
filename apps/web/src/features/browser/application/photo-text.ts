import {canExportPhotoCanvas} from './photo-export-budget'
import {MAX_MEDIA_BYTES} from '../../media/domain/media-crypto'
import {
  assertFullResolutionExport,deviceMemoryForPhotoExport,
  encodeFullResolutionJpeg,verifyFullResolutionJpeg,
} from './photo-export-budget'
import {drawPhotoShapes,validateShapeMarks} from './photo-shapes'
import type {PhotoShapeMark} from './photo-shapes'
import {drawPhotoStrokes,validatePhotoStrokes} from './photo-strokes'
import type {PhotoStroke} from './photo-strokes'
import {paintPhotoBlackouts,validatePhotoBlackouts} from './photo-blackouts'
import type {PhotoBlackout} from './photo-blackouts'

export type PhotoTextMark=Readonly<{
  id:string;text:string;x:number;y:number;size:number;color:string
}>
export type AnnotatedJpeg=Readonly<{blob:Blob;width:number;height:number}>

export const MAX_TEXT_MARKS=12
export function validateTextMarks(marks:readonly PhotoTextMark[]):void{
  if(!Array.isArray(marks)||marks.length>MAX_TEXT_MARKS)
    throw Error('viewer.text_invalid_count')
  const seen=new Set<string>()
  for(const mark of marks){
    if(!mark||typeof mark!=='object'
      ||Object.keys(mark).sort().join('|')!=='color|id|size|text|x|y'
      ||typeof mark.id!=='string'
      ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(mark.id)
      ||seen.has(mark.id)
      ||typeof mark.text!=='string'
      ||mark.text.trim().length===0||mark.text.length>220
      ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(mark.text)
      ||!Number.isSafeInteger(mark.x)||mark.x<0||mark.x>85
      ||!Number.isSafeInteger(mark.y)||mark.y<0||mark.y>85
      ||!Number.isSafeInteger(mark.size)||mark.size<2||mark.size>12
      ||typeof mark.color!=='string'||!/^#[0-9a-f]{6}$/.test(mark.color))
      throw Error('viewer.text_invalid_mark')
    seen.add(mark.id)
  }
}

function wrapLine(
  ctx:CanvasRenderingContext2D,text:string,maxWidth:number,
):string[]{
  const rows:string[]=[]
  let current=''
  // Characters are split only for words wider than the remaining canvas.
  for(const word of text.split(/\s+/u).filter(Boolean)){
    const candidate=current?current+' '+word:word
    if(ctx.measureText(candidate).width<=maxWidth){current=candidate;continue}
    if(current){rows.push(current);current=''}
    let segment=''
    for(const character of Array.from(word)){
      const next=segment+character
      if(segment&&ctx.measureText(next).width>maxWidth){
        rows.push(segment);segment=character
      }else{segment=next}
    }
    current=segment
  }
  rows.push(current)
  return rows
}

/** Draw validated text into a bounded raster. No HTML, URL or plaintext index. */
export function drawPhotoText(
  ctx:CanvasRenderingContext2D,width:number,height:number,
  marks:readonly PhotoTextMark[],
):void{
  validateTextMarks(marks)
  if(!canExportPhotoCanvas(width,height))
    throw Error('viewer.text_invalid_canvas')
  for(const mark of marks){
    const fontPx=Math.max(1,Math.round(width*mark.size/100))
    const originX=Math.round(width*mark.x/100)
    const originY=Math.round(height*mark.y/100)
    ctx.save()
    try{
      ctx.font='700 '+fontPx+'px Arial, sans-serif'
      ctx.textBaseline='top'
      ctx.lineJoin='round'
      ctx.lineWidth=Math.max(1,fontPx/7)
      ctx.strokeStyle='#111111'
      ctx.fillStyle=mark.color
      const maxWidth=Math.max(1,width-originX-2)
      const lines=mark.text.split('\n').flatMap(line=>wrapLine(ctx,line,maxWidth))
      if(lines.length>24)throw Error('viewer.text_outside_frame')
      const lineHeight=Math.ceil(fontPx*1.2)
      // Never silently discard annotations extending outside the JPEG.
      if(originY+lines.length*lineHeight>height)
        throw Error('viewer.text_outside_frame')
      for(const [i,line]of lines.entries()){
        const y=originY+i*lineHeight
        ctx.strokeText(line,originX,y,maxWidth)
        ctx.fillText(line,originX,y,maxWidth)
      }
    }finally{ctx.restore()}
  }
}

/** Flatten ONLY after the owner explicitly saves/exports a JPEG derivative. */
export async function flattenPhotoText(
  source:Blob,marks:readonly PhotoTextMark[],
):Promise<AnnotatedJpeg>{
  return flattenPhotoAnnotations(source,marks,[])
}

/** One JPEG encoder pass with shapes below text, both client-only. */
export async function flattenPhotoAnnotations(
  source:Blob,marks:readonly PhotoTextMark[],
  shapes:readonly PhotoShapeMark[],
  strokes:readonly PhotoStroke[]=[],
  blackouts:readonly PhotoBlackout[]=[],
):Promise<AnnotatedJpeg>{
  validateTextMarks(marks)
  validateShapeMarks(shapes)
  validatePhotoStrokes(strokes)
  validatePhotoBlackouts(blackouts)
  if(source.type!=='image/jpeg'||source.size<128
    ||source.size>MAX_MEDIA_BYTES)throw Error('viewer.text_invalid_source')
  if(!marks.length&&!shapes.length&&!strokes.length&&!blackouts.length)
    throw Error('viewer.annotation_no_marks')
  const bitmap=await createImageBitmap(source)
  const canvas=document.createElement('canvas')
  try{
    assertFullResolutionExport(
      bitmap.width,bitmap.height,deviceMemoryForPhotoExport())
    canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx)throw Error('viewer.text_canvas_unsupported')
    ctx.drawImage(bitmap,0,0)
    drawPhotoShapes(ctx,bitmap.width,bitmap.height,shapes)
    if(strokes.length){
      // Eraser MUST NOT punch holes in the private original, shape or text.
      // It only subtracts marks from this isolated transparent paint layer.
      const paint=document.createElement('canvas')
      paint.width=bitmap.width;paint.height=bitmap.height
      try{
        const brush=paint.getContext('2d')
        if(!brush)throw Error('viewer.stroke_canvas_unsupported')
        drawPhotoStrokes(brush,bitmap.width,bitmap.height,strokes)
        ctx.drawImage(paint,0,0)
      }finally{
        paint.width=0;paint.height=0
      }
    }
    drawPhotoText(ctx,bitmap.width,bitmap.height,marks)
    // Blackouts are composited last: the masked image pixels are replaced
    // even when previously painted shapes/text/brush cross the same region.
    paintPhotoBlackouts(ctx,bitmap.width,bitmap.height,blackouts)
    const blob=await encodeFullResolutionJpeg(canvas,0.91)
    if(blob.size<128||blob.size>MAX_MEDIA_BYTES)
      throw Error('viewer.photo_export_encode_failed')
    await verifyFullResolutionJpeg(blob,bitmap.width,bitmap.height)
    return {blob,width:bitmap.width,height:bitmap.height}
  }finally{
    bitmap.close()
    canvas.width=0;canvas.height=0
  }
}
