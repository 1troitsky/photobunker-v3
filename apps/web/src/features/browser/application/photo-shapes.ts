export type ShapeKind='arrow'|'circle'|'square'|'triangle'|'star'
export type PhotoShapeMark=Readonly<{
  id:string;kind:ShapeKind;x:number;y:number;width:number;height:number
  stroke:string;strokeWidth:number;fill:string;filled:boolean
}>
export const MAX_SHAPE_MARKS=12
const kinds:readonly ShapeKind[]=['arrow','circle','square','triangle','star']

export function validateShapeMarks(shapes:readonly PhotoShapeMark[]):void{
  if(!Array.isArray(shapes)||shapes.length>MAX_SHAPE_MARKS)
    throw Error('viewer.shape_invalid_count')
  const seen=new Set<string>()
  for(const shape of shapes){
    if(!shape||typeof shape!=='object'
      ||Object.keys(shape).sort().join('|')!==
        'fill|filled|height|id|kind|stroke|strokeWidth|width|x|y'
      ||typeof shape.id!=='string'
      ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(shape.id)
      ||seen.has(shape.id)||!kinds.includes(shape.kind)
      ||![shape.x,shape.y,shape.width,shape.height,shape.strokeWidth]
        .every(Number.isSafeInteger)
      ||shape.x<0||shape.y<0||shape.x>95||shape.y>95
      ||shape.width<5||shape.height<5||shape.x+shape.width>100
      ||shape.y+shape.height>100
      ||shape.strokeWidth<1||shape.strokeWidth>28
      ||typeof shape.stroke!=='string'||!/^#[a-f0-9]{6}$/.test(shape.stroke)
      ||typeof shape.fill!=='string'||!/^#[a-f0-9]{6}$/.test(shape.fill)
      ||typeof shape.filled!=='boolean')
      throw Error('viewer.shape_invalid_mark')
    seen.add(shape.id)
  }
}

export function drawPhotoShapes(
  ctx:CanvasRenderingContext2D,width:number,height:number,
  shapes:readonly PhotoShapeMark[],
):void{
  validateShapeMarks(shapes)
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
    ||width<1||height<1||width>4096||height>4096
    ||width*height>16_777_216)
    throw Error('viewer.shape_invalid_canvas')
  for(const shape of shapes){
    const x=width*shape.x/100,y=height*shape.y/100
    const w=width*shape.width/100,h=height*shape.height/100
    const size=Math.min(w,h)
    ctx.save()
    try{
      ctx.beginPath()
      ctx.lineWidth=Math.max(1,shape.strokeWidth*width/900)
      ctx.lineJoin='round'
      ctx.lineCap='round'
      ctx.strokeStyle=shape.stroke
      ctx.fillStyle=shape.fill
      if(shape.kind==='circle'){
        ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2)
      }else if(shape.kind==='square'){
        ctx.rect(x,y,size,size)
      }else if(shape.kind==='triangle'){
        ctx.moveTo(x+w/2,y)
        ctx.lineTo(x+w,y+h)
        ctx.lineTo(x,y+h)
        ctx.closePath()
      }else if(shape.kind==='star'){
        const cx=x+w/2,cy=y+h/2
        for(let i=0;i<10;i++){
          const rad=(i%2===0?1:0.48)*Math.min(w,h)/2
          const angle=-Math.PI/2+i*Math.PI/5
          const px=cx+Math.cos(angle)*rad
          const py=cy+Math.sin(angle)*rad
          if(i===0)ctx.moveTo(px,py)
          else ctx.lineTo(px,py)
        }
        ctx.closePath()
      }else{
        // An arrow goes bottom-left to top-right, with explicit arrowhead.
        ctx.moveTo(x,y+h);ctx.lineTo(x+w,y)
        ctx.moveTo(x+w*0.62,y);ctx.lineTo(x+w,y)
        ctx.lineTo(x+w,y+h*0.38)
      }
      if(shape.filled&&shape.kind!=='arrow')ctx.fill()
      ctx.stroke()
    }finally{ctx.restore()}
  }
}
