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
  if(typeof createImageBitmap!=='function')
    throw Error('browser.thumbnail_decoder_unavailable')
  const bitmap=await createImageBitmap(source)
  try{
    if(bitmap.width<1||bitmap.height<1||bitmap.width>16384||bitmap.height>16384)
      throw Error('browser.thumbnail_invalid_dimensions')
    const canvas=document.createElement('canvas')
    canvas.width=edge
    canvas.height=edge
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('browser.thumbnail_canvas_unavailable')
    const crop=Math.min(bitmap.width,bitmap.height)
    const x=Math.floor((bitmap.width-crop)/2)
    const y=Math.floor((bitmap.height-crop)/2)
    ctx.drawImage(bitmap,x,y,crop,crop,0,0,edge,edge)
    const result=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):
        reject(Error('browser.thumbnail_encode_failed')),'image/jpeg',0.68)
    })
    if(result.size<1||result.size>180*1024)
      throw Error('browser.thumbnail_invalid_result')
    return result
  }finally{
    bitmap.close()
  }
}
