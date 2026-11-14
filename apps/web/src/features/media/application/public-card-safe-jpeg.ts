/**
 * #211 PREPUBLICATION ONLY: a local, bounded, owner-reviewed JPEG pixel copy.
 *
 * Decode on the user's device, flatten pixels in Canvas, re-encode a fresh
 * JPEG, inspect every marker, then hash EXACT output bytes.
 * NEVER upload, cache, issue a public URL, or create a signed grant.
 * Visible pixel text/coordinates are NOT automatically redacted.
 */
export const PUBLIC_JPEG_MAX_SOURCE_BYTES=24*1024*1024
export const PUBLIC_JPEG_MAX_OUTPUT_BYTES=16*1024*1024
export const PUBLIC_JPEG_MAX_PIXELS=12_000_000
export const PUBLIC_JPEG_MAX_EDGE=4096
const MAX_SEGMENTS=512
const MAX_SCANS=32

export type SafeJpegInspection={
  width:number;height:number;scanCount:number;hasMetadata:false
}
export type PreparedSafePublicJpeg={
  blob:Blob;width:number;height:number;sha256:string
  published:false;humanReviewRequired:true
}

function invalid():never{throw Error('public_card.unsafe_jpeg')}
function allowedDimensions(width:number,height:number):boolean{
  return Number.isSafeInteger(width)&&Number.isSafeInteger(height)
    &&width>0&&height>0
    &&width<=PUBLIC_JPEG_MAX_EDGE
    &&height<=PUBLIC_JPEG_MAX_EDGE
    &&width*height<=PUBLIC_JPEG_MAX_PIXELS
}

/**
 * A deliberately narrow Canvas JPEG subset: only SOF0/2, DQT, DHT, DRI,
 * SOS, entropy, EOI and optional bare JFIF APP0 WITHOUT thumbnail.
 * No EXIF, XMP, ICC, Adobe, comments, extra frames or trailing bytes.
 * Binary marker validation is NOT JPEG decoding or pixel safety.
 */
export function inspectFlattenedSafeJpeg(bytes:Uint8Array):SafeJpegInspection{
  if(!(bytes instanceof Uint8Array)
    ||bytes.length<32||bytes.length>PUBLIC_JPEG_MAX_OUTPUT_BYTES
    ||bytes[0]!==0xff||bytes[1]!==0xd8)invalid()
  const read16=(at:number):number=>{
    if(at+1>=bytes.length)invalid()
    return (bytes[at]!<<8)|bytes[at+1]!
  }
  let p=2,segments=0,scans=0,hasFrame=false
  let hasDqt=false,hasDht=false,jfif=false,width=0,height=0
  while(p<bytes.length){
    if(++segments>MAX_SEGMENTS||bytes[p]!==0xff)invalid()
    while(p<bytes.length&&bytes[p]===0xff)p++
    if(p>=bytes.length)invalid()
    const marker=bytes[p++]!
    if(marker===0xd9){
      if(!hasFrame||!hasDqt||!hasDht||scans<1||p!==bytes.length)invalid()
      return {width,height,scanCount:scans,hasMetadata:false}
    }
    if(marker===0xd8||marker===0x00
      ||marker===0x01||(marker>=0xd0&&marker<=0xd7)
      ||marker===0xfe||(marker>=0xe1&&marker<=0xef))invalid()
    const offset=p
    const length=read16(offset)
    if(length<2||offset+length>bytes.length)invalid()
    const start=offset+2,end=offset+length
    if(marker===0xe0){
      if(jfif||hasFrame||length!==16
        ||bytes[start]!==0x4a||bytes[start+1]!==0x46
        ||bytes[start+2]!==0x49||bytes[start+3]!==0x46
        ||bytes[start+4]!==0x00
        ||bytes[start+5]!==1
        ||bytes[start+12]!==0||bytes[start+13]!==0)invalid()
      jfif=true
    }else if(marker===0xdb){
      if(length<4)invalid()
      hasDqt=true
    }else if(marker===0xc4){
      if(length<4)invalid()
      hasDht=true
    }else if(marker===0xdd){
      if(length!==4)invalid()
    }else if(marker===0xc0||marker===0xc2){
      if(hasFrame||length<11||bytes[start]!==8)invalid()
      height=read16(start+1)
      width=read16(start+3)
      const components=bytes[start+5]!
      if(!allowedDimensions(width,height)
        ||(components!==1&&components!==3)
        ||length!==8+3*components)invalid()
      hasFrame=true
    }else if(marker===0xda){
      if(!hasFrame||!hasDqt||!hasDht||length<6
        ||++scans>MAX_SCANS)invalid()
      const components=bytes[start]!
      if(components<1||components>3||length!==6+2*components)invalid()
      let entropy=0
      p=end
      while(p<bytes.length){
        if(bytes[p]!==0xff){entropy++;p++;continue}
        if(p+1>=bytes.length)invalid()
        const code=bytes[p+1]!
        if(code===0x00){entropy++;p+=2;continue}
        if(code>=0xd0&&code<=0xd7){p+=2;continue}
        break
      }
      if(entropy<1)invalid()
      continue
    }else{
      invalid()
    }
    p=end
  }
  invalid()
}

/**
 * Chromium's sRGB Canvas encoder inserts an APP2 ICC_PROFILE payload.
 * A fresh profile is color-management metadata, not EXIF, but keeping it
 * breaks a *metadata-free* JPEG contract. Remove ONLY this exact single ICC
 * header from the fresh Canvas output; still reject every other APPn, COM,
 * malformed JFIF and every byte after EOI in the strict marker verifier.
 *
 * All returned bytes are re-validated and independently JPEG-decoded.
 */
export function stripCanvasIccProfile(bytes:Uint8Array):Uint8Array{
  if(bytes[0]!==0xff||bytes[1]!==0xd8)
    throw Error('public_card.unsafe_jpeg')
  let offset=2
  // Preserve optional APP0 for later strict JFIF verification.
  if(bytes[offset]===0xff&&bytes[offset+1]===0xe0){
    if(offset+4>bytes.length)throw Error('public_card.unsafe_jpeg')
    const length=(bytes[offset+2]!<<8)|bytes[offset+3]!
    if(length<2||offset+2+length>bytes.length)
      throw Error('public_card.unsafe_jpeg')
    offset+=2+length
  }
  if(bytes[offset]!==0xff||bytes[offset+1]!==0xe2)return bytes
  if(offset+18>bytes.length)throw Error('public_card.unsafe_jpeg')
  const length=(bytes[offset+2]!<<8)|bytes[offset+3]!
  const end=offset+2+length
  if(length<16||end>bytes.length)
    throw Error('public_card.unsafe_jpeg')
  const header=[0x49,0x43,0x43,0x5f,0x50,0x52,
    0x4f,0x46,0x49,0x4c,0x45,0x00]
  for(let i=0;i<header.length;i++){
    if(bytes[offset+4+i]!==header[i])
      throw Error('public_card.unsafe_jpeg')
  }
  // Single sRGB ICC block only. Multipart/other profiles fail closed.
  if(bytes[offset+16]!==1||bytes[offset+17]!==1)
    throw Error('public_card.unsafe_jpeg')
  const stripped=new Uint8Array(bytes.byteLength-(end-offset))
  stripped.set(bytes.subarray(0,offset))
  stripped.set(bytes.subarray(end),offset)
  return stripped
}

function toHex(bytes:Uint8Array):string{
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
}

/** No network, IndexedDB, OS gallery or automatic publication. */
export async function prepareSafePublicJpeg(source:Blob):Promise<PreparedSafePublicJpeg>{
  if(!(source instanceof Blob)||source.type!=='image/jpeg'
    ||source.size<32||source.size>PUBLIC_JPEG_MAX_SOURCE_BYTES)
    throw Error('public_card.invalid_source_jpeg')
  if(typeof createImageBitmap!=='function'
    ||typeof document==='undefined'||typeof crypto==='undefined'
    ||!crypto.subtle)
    throw Error('public_card.browser_codec_unavailable')
  let decoded:ImageBitmap|null=null
  let verified:ImageBitmap|null=null
  let canvas:HTMLCanvasElement|null=null
  try{
    decoded=await createImageBitmap(source)
    if(!allowedDimensions(decoded.width,decoded.height))
      throw Error('public_card.unsafe_dimensions')
    canvas=document.createElement('canvas')
    canvas.width=decoded.width
    canvas.height=decoded.height
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx)throw Error('public_card.browser_codec_unavailable')
    ctx.fillStyle='#fff'
    ctx.fillRect(0,0,canvas.width,canvas.height)
    ctx.drawImage(decoded,0,0,canvas.width,canvas.height)
    const target=canvas
    const blob=await new Promise<Blob>((resolve,reject)=>{
      let settled=false
      const timer=setTimeout(()=>{
        if(settled)return
        settled=true
        reject(Error('public_card.jpeg_timeout'))
      },30_000)
      try{
        target.toBlob(candidate=>{
          if(settled)return
          settled=true
          clearTimeout(timer)
          if(!candidate||candidate.type!=='image/jpeg')
            reject(Error('public_card.jpeg_encode_failed'))
          else resolve(candidate)
        },'image/jpeg',0.9)
      }catch{
        if(!settled){
          settled=true
          clearTimeout(timer)
          reject(Error('public_card.jpeg_encode_failed'))
        }
      }
    })
    if(blob.size>PUBLIC_JPEG_MAX_OUTPUT_BYTES)
      throw Error('public_card.unsafe_dimensions')
    const bytes=stripCanvasIccProfile(
      new Uint8Array(await blob.arrayBuffer())
    )
    const inspected=inspectFlattenedSafeJpeg(bytes)
    if(inspected.width!==decoded.width||inspected.height!==decoded.height)
      throw Error('public_card.jpeg_dimension_changed')
    const finalBlob=new Blob([new Uint8Array(bytes)],{type:'image/jpeg'})
    verified=await createImageBitmap(finalBlob)
    if(verified.width!==decoded.width||verified.height!==decoded.height)
      throw Error('public_card.jpeg_decode_mismatch')
    const hash=new Uint8Array(await crypto.subtle.digest(
      'SHA-256',new Uint8Array(bytes)
    ))
    return {
      blob:finalBlob,width:inspected.width,height:inspected.height,
      sha256:toHex(hash),published:false,humanReviewRequired:true,
    }
  }catch(e){
    if(e instanceof Error&&e.message.startsWith('public_card.'))throw e
    throw Error('public_card.jpeg_decode_or_encode_failed')
  }finally{
    verified?.close()
    decoded?.close()
    if(canvas){canvas.width=0;canvas.height=0}
  }
}
