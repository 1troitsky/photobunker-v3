export type StrokeTool='brush'|'pencil'|'eraser'
export type StrokePoint=Readonly<{x:number;y:number}>
export type PhotoStroke=Readonly<{
  id:string;tool:StrokeTool;color:string;width:number
  points:readonly StrokePoint[]
}>
export const MAX_PHOTO_STROKES=80
export const MAX_STROKE_POINTS=1500
export const MAX_TOTAL_STROKE_POINTS=12000
const HEX=/^#[a-f0-9]{6}$/
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

export function validatePhotoStrokes(strokes:readonly PhotoStroke[]):void{
  if(!Array.isArray(strokes)||strokes.length>MAX_PHOTO_STROKES)
    throw Error('viewer.stroke_invalid_count')
  const ids=new Set<string>()
  let points=0
  for(const item of strokes){
    if(!item||typeof item!=='object'
      ||Object.keys(item).sort().join('|')!=='color|id|points|tool|width'
      ||typeof item.id!=='string'||!UUID.test(item.id)||ids.has(item.id)
      ||!['brush','pencil','eraser'].includes(item.tool)
      ||typeof item.color!=='string'||!HEX.test(item.color)
      ||!Number.isSafeInteger(item.width)||item.width<2||item.width>36
      ||!Array.isArray(item.points)||item.points.length<1
      ||item.points.length>MAX_STROKE_POINTS)
      throw Error('viewer.stroke_invalid_mark')
    ids.add(item.id)
    points+=item.points.length
    for(const point of item.points){
      if(!point||typeof point!=='object'
        ||Object.keys(point).sort().join('|')!=='x|y'
        ||!Number.isSafeInteger(point.x)||!Number.isSafeInteger(point.y)
        ||point.x<0||point.x>1000||point.y<0||point.y>1000)
        throw Error('viewer.stroke_invalid_point')
    }
  }
  if(points>MAX_TOTAL_STROKE_POINTS)
    throw Error('viewer.stroke_invalid_count')
}

/**
 * Paint solely on a transparent strokes layer. The eraser uses
 * destination-out HERE, never on the original media or text/shapes.
 * Strokes are stored as normalized integer 0-1000 coordinates.
 */
export function drawPhotoStrokes(
  ctx:CanvasRenderingContext2D,width:number,height:number,
  strokes:readonly PhotoStroke[],
):void{
  validatePhotoStrokes(strokes)
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
    ||width<1||height<1||width>4096||height>4096
    ||width*height>16_777_216)
    throw Error('viewer.stroke_invalid_canvas')
  for(const stroke of strokes){
    const points=stroke.points
    ctx.save()
    try{
      ctx.globalCompositeOperation=stroke.tool==='eraser'
        ?'destination-out':'source-over'
      ctx.strokeStyle=stroke.tool==='eraser'?'#000000':stroke.color
      ctx.fillStyle=ctx.strokeStyle
      ctx.lineWidth=Math.max(1,stroke.width*width/900)
      ctx.lineCap=stroke.tool==='pencil'?'square':'round'
      ctx.lineJoin=stroke.tool==='pencil'?'miter':'round'
      const first=points[0]!
      const x=first.x*width/1000,y=first.y*height/1000
      if(points.length===1){
        ctx.beginPath()
        ctx.arc(x,y,ctx.lineWidth/2,0,Math.PI*2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      ctx.moveTo(x,y)
      for(let i=1;i<points.length;i++){
        const p=points[i]!
        ctx.lineTo(p.x*width/1000,p.y*height/1000)
      }
      ctx.stroke()
    }finally{ctx.restore()}
  }
}
