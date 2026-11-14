import {expect,test} from '@playwright/test'
import {readFile} from 'node:fs/promises'

/**
 * Stacked #334 + #331 USER-FACING P2 #215 acceptance: a real video is
 * decrypted in protected FileViewer, the trim controls drive a real
 * MediaRecorder encoder, and the separate derivative is persisted as an
 * encrypted signed Local-First media asset while the browser is OFFLINE.
 * No OS gallery/download, no metadata or grant inheritance from source.
 */
test('P2 #215 UI: Video Editor trim → genuine E2EE clip offline; original and source permissions unchanged',async({browser})=>{
  test.setTimeout(150_000)
  const fixture=(await readFile(new URL(
    './fixtures/p2-video-clip-215-vp8.base64',import.meta.url),'utf8')).trim()
  const context=await browser.newContext()
  const page=await context.newPage()
  let downloads=0
  page.on('download',()=>{downloads++})
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()

    await page.goto('/browser')
    const mediaId=await page.evaluate(async base64=>{
      const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))
      const source=new File([data],'PRIVATE-SOURCE-VIDEO.webm',{type:'video/webm'})
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(source,undefined,{
        category:'Исходные сведения',description:'Описание не наследуется',
        tags:['original'],
      })
      const stored=await media.readLocalMedia(id)
      if(stored.blob.size!==data.byteLength)
        throw Error('encrypted_source_readback_bad')
      return id
    },fixture)

    await page.goto('/browser/file/media/'+mediaId)
    await page.getByTestId('viewer-action-edit').click()
    const video=page.getByTestId('file-viewer-video')
    await expect(video).toBeVisible()
    await expect.poll(()=>video.evaluate((node:HTMLVideoElement)=>
      node.readyState),{timeout:25_000}).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('file-editor-video-trim')).toBeVisible()
    await expect(page.getByTestId('file-editor-video-selected')).toContainText('3.0 с')

    // User-supplied ranges via the real Vue v-model input/change listeners.
    const changeRange=async(id:string,value:string)=>{
      await page.getByTestId(id).evaluate((input:HTMLInputElement,value)=>{
        const setter=Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,'value')?.set
        if(!setter)throw Error('range_setter_missing')
        setter.call(input,value)
        input.dispatchEvent(new Event('input',{bubbles:true}))
        input.dispatchEvent(new Event('change',{bubbles:true}))
      },value)
    }
    await changeRange('file-editor-video-start','0.5')
    await changeRange('file-editor-video-end','2.2')
    await expect(page.getByTestId('file-editor-video-selected'))
      .toContainText('1.7 с')

    await context.setOffline(true)
    const before=await page.evaluate(async()=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia()).length
    })
    expect(before).toBe(1)

    await page.getByTestId('file-editor-video-save-clip').click()
    await expect(page.getByTestId('file-editor-video-clip-status'))
      .toContainText('зашифрован',{timeout:40_000})
    await expect(page.getByTestId('file-editor-video-clip-error')).toHaveCount(0)
    expect(downloads).toBe(0)

    const result=await page.evaluate(async sourceId=>{
      const media=await import('/src/features/media/application/media-outbox.ts')
      const stored=await media.listLocalMedia()
      const source=stored.find(x=>x.mediaId===sourceId)
      const derivative=stored.find(x=>x.mediaId!==sourceId)
      if(!source||!derivative)throw Error('derivative_missing_from_encrypted_IDB')
      const original=await media.readLocalMedia(sourceId)
      const output=await media.readLocalMedia(derivative.mediaId)
      // Actual browser can open the independently generated encoded video.
      const url=URL.createObjectURL(output.blob)
      const video=document.createElement('video')
      video.src=url;video.preload='auto';video.muted=true
      video.playsInline=true
      try{
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('derivative_decode_timeout')),12000)
          video.onloadeddata=()=>{clearTimeout(timer);resolve()}
          video.onerror=()=>{clearTimeout(timer);reject(Error('derivative_decode_fail'))}
          video.load()
        })
        return {
          count:stored.length,
          sourceBytes:source.plainBytes,
          sourceName:original.metadata.fileName,
          sourceCategory:original.metadata.category,
          sourceDescription:original.metadata.description,
          sourceTags:original.metadata.tags,
          derivativeState:derivative.state,
          derivativeType:derivative.mediaType,
          derivativeMime:output.blob.type,
          derivativeSize:derivative.plainBytes,
          outputSize:output.blob.size,
          derivativeName:output.metadata.fileName,
          derivativeCategory:output.metadata.category??null,
          derivativeDescription:output.metadata.description??null,
          derivativeTags:output.metadata.tags??[],
          derivativeGPS:output.metadata.gps??null,
          derivativeCapture:derivative.capture??null,
          publicContractLeaksName:JSON.stringify(derivative.contract)
            .includes('PRIVATE-SOURCE-VIDEO'),
          width:video.videoWidth,height:video.videoHeight,
        }
      }finally{
        video.pause()
        video.removeAttribute('src')
        video.load()
        URL.revokeObjectURL(url)
      }
    },mediaId)
    expect(result).toMatchObject({
      count:2,sourceBytes:656,sourceName:'PRIVATE-SOURCE-VIDEO.webm',
      sourceCategory:'Исходные сведения',sourceDescription:'Описание не наследуется',
      sourceTags:['original'],
      derivativeState:'queued',derivativeType:'video',
      derivativeCategory:null,derivativeDescription:null,
      derivativeTags:[],derivativeGPS:null,derivativeCapture:null,
      publicContractLeaksName:false,width:32,height:32,
    })
    expect(result.derivativeSize).toBeGreaterThan(64)
    expect(result.outputSize).toBe(result.derivativeSize)
    expect(['video/mp4','video/webm']).toContain(result.derivativeMime)
    expect(result.derivativeName).toBe(
      'PRIVATE-SOURCE-VIDEO-clip-500-2200.'
      +(result.derivativeMime==='video/mp4'?'mp4':'webm'))
    expect(downloads).toBe(0)
  }finally{
    await context.close()
  }
})
