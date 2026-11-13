import {expect,test,type Page} from '@playwright/test'

async function register(page:Page):Promise<void>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
}

async function countLocalMedia(page:Page):Promise<number>{
  return page.evaluate(async()=>{
    const media=await import('/src/features/media/application/media-outbox.ts')
    return (await media.listLocalMedia()).length
  })
}

test('P2 #206 genuine Chromium microphone denial requires explicit retry, without private UA error leakage',async({page})=>{
  test.setTimeout(110_000)
  await register(page)
  await page.addInitScript(()=>{
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let denyOnce=true
    navigator.mediaDevices.getUserMedia=(constraints:MediaStreamConstraints)=>{
      if(constraints.audio===true&&constraints.video===false&&denyOnce){
        denyOnce=false
        return Promise.reject(new DOMException('PRIVATE-PLATFORM-MIC-DENIAL','NotAllowedError'))
      }
      return native(constraints)
    }
  })
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByRole('alert'))
    .toContainText('camera.microphone_permission_denied',{timeout:20_000})
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE-PLATFORM-MIC-DENIAL')
  await expect(page.getByTestId('camera-start-recording')).toBeDisabled()
  expect(await countLocalMedia(page)).toBe(0)
  // A rejected getUserMedia must not cause any automatic retries.
  await page.getByRole('button',{name:'Включить микрофон'}).click()
  await expect(page.getByTestId('camera-start-recording')).toBeEnabled({timeout:20_000})
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await countLocalMedia(page)).toBe(0)
})

test('P2 #206 native MediaStreamTrack ended aborts an otherwise long enough real audio capture',async({page})=>{
  test.setTimeout(120_000)
  await register(page)
  await page.addInitScript(()=>{
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    ;(window as any).__p2MicStream=null as MediaStream|null
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const result=await native(constraints)
      if(constraints.audio===true&&constraints.video===false)
        (window as any).__p2MicStream=result
      return result
    }
  })
  await page.goto('/camera')
  await expect(page.getByRole('button',{name:'Сделать снимок'}))
    .toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-mode').selectOption('audio')
  await expect(page.getByTestId('camera-start-recording')).toBeEnabled({timeout:20_000})
  await page.getByTestId('camera-start-recording').click()
  await expect(page.getByTestId('camera-recording-status')).toBeVisible({timeout:15_000})
  // Real microphone and native MediaRecorder, no fake capture or virtual clock.
  // >5s ensures this interruption isn't merely the minimum-duration rejection.
  await page.waitForTimeout(5_200)
  await page.evaluate(()=>{
    const stream=(window as any).__p2MicStream as MediaStream|null
    if(!stream||!stream.getAudioTracks().length)throw Error('fixture.real_audio_missing')
    const track=stream.getAudioTracks()[0]!
    if(track.readyState!=='live')throw Error('fixture.audio_not_live')
    // Synthetic dispatch exercises the actual browser track event listener;
    // this does NOT claim real OS permission revocation was tested.
    track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByText('camera.recording_interrupted')).toBeVisible({timeout:15_000})
  await expect(page.getByTestId('camera-recording-status')).toHaveCount(0)
  const state=await page.evaluate(async()=>{
    const stream=(window as any).__p2MicStream as MediaStream
    const media=await import('/src/features/media/application/media-outbox.ts')
    return {ended:stream.getTracks().every(track=>track.readyState==='ended'),
      rows:(await media.listLocalMedia()).length}
  })
  expect(state).toEqual({ended:true,rows:0})
  await page.waitForTimeout(300)
  expect(await countLocalMedia(page)).toBe(0)
})
