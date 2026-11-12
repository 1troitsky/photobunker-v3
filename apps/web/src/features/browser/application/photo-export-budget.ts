/**
 * Native-resolution photo derivative policy, independent of the 1MP preview.
 * This is a conservative memory envelope, not a promise all devices can
 * allocate a large Canvas. Native encoding failures must fail closed.
 */
export const MAX_EXPORT_EDGE=8192
export const MAX_EXPORT_PIXELS=24_000_000
export const LOW_MEMORY_EXPORT_PIXELS=8_000_000
export const UNKNOWN_MEMORY_EXPORT_PIXELS=12_000_000
export const PHOTO_ENCODE_TIMEOUT_MS=30_000

export function canExportPhotoCanvas(width:number,height:number):boolean{
  return Number.isSafeInteger(width)&&Number.isSafeInteger(height)
    &&width>=1&&height>=1&&width<=MAX_EXPORT_EDGE
    &&height<=MAX_EXPORT_EDGE&&width*height<=MAX_EXPORT_PIXELS
}

export function safeExportPixelBudget(memoryGiB?:number):number{
  if(memoryGiB===undefined||!Number.isFinite(memoryGiB)||memoryGiB<=0)
    return UNKNOWN_MEMORY_EXPORT_PIXELS
  return memoryGiB<4?LOW_MEMORY_EXPORT_PIXELS:MAX_EXPORT_PIXELS
}

export function assertFullResolutionExport(
  width:number,height:number,memoryGiB?:number,
):void{
  if(!canExportPhotoCanvas(width,height)
    ||width*height>safeExportPixelBudget(memoryGiB))
    throw Error('viewer.photo_export_exceeds_safe_budget')
}

export function deviceMemoryForPhotoExport():number|undefined{
  if(typeof navigator==='undefined')return undefined
  const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory
  return typeof memory==='number'&&Number.isFinite(memory)?memory:undefined
}

/**
 * No hidden resizing, quality fallback or endlessly pending Canvas encode.
 * A late callback after a deadline is ignored; callers discard their Canvas.
 */
export function encodeFullResolutionJpeg(
  canvas:HTMLCanvasElement,quality=0.9,timeoutMs=PHOTO_ENCODE_TIMEOUT_MS,
):Promise<Blob>{
  if(!canExportPhotoCanvas(canvas.width,canvas.height))
    return Promise.reject(Error('viewer.photo_export_exceeds_safe_budget'))
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1
    ||timeoutMs>PHOTO_ENCODE_TIMEOUT_MS)
    return Promise.reject(Error('viewer.photo_export_invalid_timeout'))
  return new Promise<Blob>((resolve,reject)=>{
    let settled=false
    const timeout=setTimeout(()=>{
      if(settled)return
      settled=true
      reject(Error('viewer.photo_export_timeout'))
    },timeoutMs)
    try{
      canvas.toBlob(blob=>{
        if(settled)return
        settled=true
        clearTimeout(timeout)
        if(!blob||blob.type!=='image/jpeg')
          reject(Error('viewer.photo_export_encode_failed'))
        else resolve(blob)
      },'image/jpeg',quality)
    }catch{
      if(settled)return
      settled=true
      clearTimeout(timeout)
      reject(Error('viewer.photo_export_encode_failed'))
    }
  })
}

export function describePhotoExportError(error:unknown):string{
  const code=error instanceof Error?error.message:'viewer.photo_export_failed'
  if(code==='viewer.photo_export_exceeds_safe_budget')
    return 'Полноразмерный JPEG превышает безопасный лимит памяти устройства. '
      +'Уменьшите область кадра; изображение не будет уменьшено автоматически.'
  if(code==='viewer.photo_export_timeout')
    return 'Время создания полноразмерного JPEG истекло. '
      +'Файл не сохранён. Уменьшите область кадра и повторите попытку.'
  if(code==='viewer.photo_export_encode_failed')
    return 'Устройство не смогло создать полноразмерный JPEG. '
      +'Файл не сохранён; исходное фото осталось неизменным.'
  if(code==='viewer.photo_export_wrong_dimensions')
    return 'Проверка размера JPEG не пройдена: файл не сохранён, '
      +'чтобы избежать скрытого уменьшения изображения.'
  return code
}
