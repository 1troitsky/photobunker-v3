import {expect,test} from '@playwright/test'
import {readFile} from 'node:fs/promises'

/**
 * P2 #215 ONLY: the user-facing File Viewer is owned by a parallel agent.
 * Test the actual independent clip encoder against native Chromium decoder,
 * real MediaRecorder, and the existing E2EE offline MediaFile outbox.
 * Fixture is synthetic red pixels (ffmpeg H264+MP4, 3 seconds), not user data.
 */
test('P2 #215: real decoded video → NEW encoded clip → encrypted local MediaFile; no OS gallery',async({browser})=>{
  test.setTimeout(125_000)
  const fixture=(await readFile(new URL('./fixtures/p2-video-clip-215.base64',import.meta.url),'utf8')).trim()
  const context=await browser.newContext()
  const page=await context.newPage()
  let downloads=0
  page.on('download',()=>downloads++)
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await context.setOffline(true)

    const verified=await page.evaluate(async(base64)=>{
      const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))
      const original=new Blob([data],{type:'video/mp4'})
      const sourceUrl=URL.createObjectURL(original)
      const video=document.createElement('video')
      video.src=sourceUrl
      video.muted=true
      video.playsInline=true
      video.preload='auto'
      document.body.appendChild(video)
      try{
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('fixture_metadata_timeout')),15_000)
          video.onloadedmetadata=()=>{
            clearTimeout(timer)
            resolve()
          }
          video.onerror=()=>{
            clearTimeout(timer)
            reject(Error('fixture_not_decodable'))
          }
          video.load()
        })
        if(!Number.isFinite(video.duration)
          ||video.duration<2.95||video.duration>3.05
          ||video.videoWidth!==32||video.videoHeight!==32)
          throw Error('fixture_bad_duration_or_pixels')
        const initialTime=video.currentTime
        const {activeSession}=await import('/src/features/identity/application/session.ts')
        const currentAccount=activeSession.value?.accountId
        if(!currentAccount)throw Error('expected_authenticated_account')
        const {exportRealVideoClip}=await import(
          '/src/features/browser/application/video-clip-export.ts'
        )
        const clip=await exportRealVideoClip({
          source:video,sourceName:'SYNTHETIC-SOURCE.mp4',
          startMs:500,endMs:2200,
          assertAuthorized:()=>{
            if(activeSession.value?.accountId!==currentAccount)
              throw Error('identity.account_changed')
          },
        })
        if(video.currentTime!==initialTime)
          throw Error('mutated_original_viewer_playback')
        if(clip.blob.size<64||clip.blob.size>128*1024*1024
          ||!['video/webm','video/mp4'].includes(clip.mime)
          ||clip.file.type!==clip.mime
          ||clip.durationMs!==1700)
          throw Error('encoder_output_not_bounded')

        // Verify a genuine encoded clip is independently decodable.
        const generatedUrl=URL.createObjectURL(clip.blob)
        const verification=document.createElement('video')
        verification.src=generatedUrl
        verification.muted=true
        verification.preload='auto'
        try{
          await new Promise<void>((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('clip_decoder_timeout')),15_000)
            verification.onloadeddata=()=>{
              clearTimeout(timer)
              resolve()
            }
            verification.onerror=()=>{
              clearTimeout(timer)
              reject(Error('clip_decoder_failed'))
            }
            verification.load()
          })
          if(verification.videoWidth!==32||verification.videoHeight!==32
            ||verification.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)
            throw Error('clip_missing_decodable_video')
        }finally{
          verification.pause()
          verification.removeAttribute('src')
          verification.load()
          URL.revokeObjectURL(generatedUrl)
        }

        // The browser is OFFLINE. No OS download, only authenticated local
        // AES-GCM encrypted chunks and signed contract in IndexedDB.
        const media=await import('/src/features/media/application/media-outbox.ts')
        const mediaId=await media.enqueueEncryptedMedia(clip.file)
        const stored=(await media.listLocalMedia())
          .find(entry=>entry.mediaId===mediaId)
        if(!stored)throw Error('encrypted_outbox_missing')
        const restored=await media.readLocalMedia(mediaId)
        const header=new Uint8Array(await restored.blob.slice(0,16).arrayBuffer())
        const expected=clip.mime==='video/mp4'
          ?header[4]===0x66&&header[5]===0x74&&header[6]===0x79&&header[7]===0x70
          :header[0]===0x1a&&header[1]===0x45
            &&header[2]===0xdf&&header[3]===0xa3
        return {
          mime:clip.mime,ext:clip.file.name.split('.').at(-1),
          clipBytes:clip.file.size,storedBytes:restored.blob.size,
          accountIdMatches:stored.accountId===currentAccount,
          mediaType:stored.mediaType,state:stored.state,
          originalBytes:data.length,sourceUnchanged:original.size===data.length,
          signedNameLeaked:JSON.stringify(stored.contract).includes('SYNTHETIC-SOURCE'),
          savedName:restored.metadata.fileName,
          encryptedChunks:stored.chunks.length,bytesVerify:expected,
        }
      }finally{
        video.pause()
        video.removeAttribute('src')
        video.load()
        video.remove()
        URL.revokeObjectURL(sourceUrl)
      }
    },fixture)

    expect(verified).toMatchObject({
      accountIdMatches:true,
      mediaType:'video',state:'queued',sourceUnchanged:true,
      signedNameLeaked:false,bytesVerify:true,
    })
    expect(verified.clipBytes).toBeGreaterThan(64)
    expect(verified.encryptedChunks).toBeGreaterThan(0)
    expect(verified.storedBytes).toBe(verified.clipBytes)
    expect(verified.savedName).toBe('SYNTHETIC-SOURCE-clip-500-2200.'+verified.ext)
    expect(verified.ext).toBe(verified.mime==='video/mp4'?'mp4':'webm')
    expect(downloads).toBe(0)
  }finally{
    await context.close()
  }
})
