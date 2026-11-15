/**
 * A volatile, preview-only thumbnail from an authenticated E2EE media Blob.
 * Nothing is written to IndexedDB, an OS gallery or the server. Canvas
 * re-encoding drops embedded image metadata (including source GPS/EXIF).
 *
 * Callers own and must revoke the URL built from the returned tiny Blob.
 */
export async function makeBrowserFolderThumbnail(
  source:Blob,edge=96,
):Promise<Blob>{
  if(!Number.isSafeInteger(edge)||edge<24||edge>256
    ||source.size<1||source.size>24*1024*1024
    ||!/^image\/(?:jpeg|png|webp|gif|avif)$/i.test(source.type))
    throw Error('browser.thumbnail_unsupported')
  let image:ImageBitmap|HTMLImageElement
  let width:number,height:number
  let release:()=>void
  if(typeof createImageBitmap==='function'){
    const bitmap=await createImageBitmap(source)
    image=bitmap
    width=bitmap.width;height=bitmap.height
    release=()=>bitmap.close()
  }else{
    // Some WebKit installations lack ImageBitmap; the original object URL
    // is temporary and revoked even when image decoding fails or times out.
    const url=URL.createObjectURL(source)
    const element=new Image()
    try{
      await new Promise<void>((resolve,reject)=>{
        let settled=false
        const finish=(error?:Error):void=>{
          if(settled)return
          settled=true
          clearTimeout(timer)
          element.onload=null;element.onerror=null
          if(error)reject(error)
          else resolve()
        }
        const timer=setTimeout(()=>finish(Error('browser.thumbnail_decode_timeout')),8000)
        element.onload=()=>finish()
        element.onerror=()=>finish(Error('browser.thumbnail_decode_failed'))
        element.src=url
      })
    }catch(e){
      element.src=''
      URL.revokeObjectURL(url)
      throw e
    }
    image=element
    width=element.naturalWidth;height=element.naturalHeight
    release=()=>{element.src='';URL.revokeObjectURL(url)}
  }
  try{
      if(width<1||height<1||width>16384||height>16384)
      throw Error('browser.thumbnail_invalid_dimensions')
    const canvas=document.createElement('canvas')
    canvas.width=edge
    canvas.height=edge
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('browser.thumbnail_canvas_unavailable')
    const crop=Math.min(width,height)
    const x=Math.floor((width-crop)/2)
    const y=Math.floor((height-crop)/2)
    ctx.drawImage(image,x,y,crop,crop,0,0,edge,edge)
    const result=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):
        reject(Error('browser.thumbnail_encode_failed')),'image/jpeg',0.68)
    })
    if(result.size<1||result.size>180*1024)
      throw Error('browser.thumbnail_invalid_result')
    return result
  }finally{
    release()
  }
}
