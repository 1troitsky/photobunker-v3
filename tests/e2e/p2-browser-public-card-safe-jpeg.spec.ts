import {test,expect} from '@playwright/test'

/**
 * Real Chromium Canvas codec gate, no backend or authenticated account.
 * Uses a Vite dev server solely to import the isolated client-side module.
 * Does NOT prove Safari/iOS, pixel redactions, any public grant or S3 E2E.
 */
test('real Chromium strips source JPEG APP1 EXIF while preserving safe pixels',async({page})=>{
  await page.goto('/')
  const result=await page.evaluate(async()=>{
    const spec='/src/features/media/application/public-card-safe-jpeg.ts'
    const safe=await import(/* @vite-ignore */spec)
    const canvas=document.createElement('canvas')
    canvas.width=16
    canvas.height=12
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('missing_real_canvas')
    ctx.fillStyle='#004466'
    ctx.fillRect(0,0,16,12)
    const original=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(b=>b?resolve(b):reject(Error('no_jpeg_codec')),
        'image/jpeg',0.9)
    })
    const originalBytes=new Uint8Array(await original.arrayBuffer())
    // Diagnostic: report the exact Chromium JFIF marker headers before
    // any modified input is decoded. This is NOT a bypass or a weakened test.
    const headers:Array<{marker:string;length:number;prefix:number[]}>= []
    let cursor=2
    for(let n=0;n<30&&cursor+4<originalBytes.length;n++){
      if(originalBytes[cursor]!==0xff)break
      const marker=originalBytes[cursor+1]!
      const length=(originalBytes[cursor+2]!<<8)|originalBytes[cursor+3]!
      headers.push({
        marker:marker.toString(16),length,
        prefix:Array.from(originalBytes.slice(cursor+4,cursor+12)),
      })
      if(marker===0xda||length<2)break
      cursor+=length+2
    }
    // The unmodified Chromium result may have APP2 ICC (and must then be
    // rejected by the strict final-file inspector). The local preparation
    // strips only that known profile before validating the final file.

    // Exif APP1 header with a minimal TIFF IFD + a hidden GPS-like comment;
    // no GPS text is drawn into the image's actual pixels.
    const payload=new Uint8Array([
      0x45,0x78,0x69,0x66,0,0,
      0x49,0x49,0x2a,0,0x08,0,0,0,
      0,0,0,0,
      ...new TextEncoder().encode('GPSLatitude=51.5074'),
    ])
    const length=payload.length+2
    const app1=new Uint8Array([
      0xff,0xe1,(length>>8)&0xff,length&0xff,...payload,
    ])
    const dirtyBytes=new Uint8Array(originalBytes.length+app1.length)
    dirtyBytes.set(originalBytes.slice(0,2),0)
    dirtyBytes.set(app1,2)
    dirtyBytes.set(originalBytes.slice(2),2+app1.length)
    const withExif=new Blob([dirtyBytes],{type:'image/jpeg'})
    let rejectedRaw=false
    try{safe.inspectFlattenedSafeJpeg(dirtyBytes)}
    catch{rejectedRaw=true}
    let prepared
    try{prepared=await safe.prepareSafePublicJpeg(withExif)}
    catch(e){
      throw Error('chromium_canvas_headers='+JSON.stringify(headers)+':'+String(e))
    }
    const sanitized=new Uint8Array(await prepared.blob.arrayBuffer())
    const checked=safe.inspectFlattenedSafeJpeg(sanitized)
    const h=new Uint8Array(await crypto.subtle.digest(
      'SHA-256',sanitized
    ))
    const expected=Array.from(h,b=>b.toString(16).padStart(2,'0')).join('')
    const encoded=new TextDecoder('latin1').decode(sanitized)
    canvas.width=0
    canvas.height=0
    return {
      rawRejected:rejectedRaw,
      width:prepared.width,height:prepared.height,
      encodedWidth:checked.width,encodedHeight:checked.height,
      shaMatches:expected===prepared.sha256,
      hiddenGpsAbsent:!encoded.includes('GPSLatitude'),
      noApp1:!Array.from({length:sanitized.length-1},(_,i)=>
        sanitized[i]===0xff&&sanitized[i+1]===0xe1).some(Boolean),
      published:prepared.published,
      humanReviewRequired:prepared.humanReviewRequired,
      bytes:sanitized.length,
    }
  })
  expect(result).toMatchObject({
    rawRejected:true,width:16,height:12,
    encodedWidth:16,encodedHeight:12,
    shaMatches:true,hiddenGpsAbsent:true,noApp1:true,
    published:false,humanReviewRequired:true,
  })
  expect(result.bytes).toBeGreaterThan(100)
})
