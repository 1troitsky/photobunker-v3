import {expect,test,type Browser,type Page} from '@playwright/test'

type GeoOptions=Readonly<{enableHighAccuracy?:boolean;maximumAge?:number;timeout?:number}>
type SyntheticPosition={latitude:number;longitude:number;accuracy:number}
const validFix:SyntheticPosition={latitude:38.487329,longitude:-122.893741,accuracy:4.5}

async function register(page:Page):Promise<void>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
}

async function cameraReady(page:Page,assignmentId?:string):Promise<void>{
  await page.goto(assignmentId?'/camera?assignmentId='+assignmentId:'/camera')
  if(assignmentId)await expect(page.locator('#camera-assignment'))
    .toHaveValue(assignmentId,{timeout:30000})
  await expect.poll(()=>page.locator('video')
    .evaluate(el=>(el as HTMLVideoElement).videoWidth),{timeout:30000})
    .toBeGreaterThan(0)
  await expect(page.getByRole('button',{name:'Сделать снимок'})).toBeEnabled()
}

async function localPhotos(page:Page){
  return page.evaluate(async()=>{
    const m=await import('/src/features/photo-sync/application/p1-photo.ts')
    return (await m.listLocalPhotos()).map(photo=>({
      photoId:photo.photoId,state:photo.state,contract:m.signedPhotoContract(photo),
      assetTypes:photo.assets.map(asset=>asset.blob.type),
    }))
  })
}

async function makeSignedGpsRequiredAssignment(page:Page):Promise<string>{
  await page.goto('/assignments')
  await page.getByRole('button',{name:'Создать задание'}).click()
  await page.locator('#assignment-title').fill('Synthetic QA GPS consent assignment')
  await page.locator('#assignment-instructions').fill('GPS consent must be requested and checked')
  await page.getByRole('button',{name:'Создать зашифрованное задание'}).click()
  await page.getByRole('button',{name:'Синхронизировать'}).click()
  const code=page.locator('.assignment-detail code').first()
  await expect(code).toBeVisible({timeout:30000})
  const assignmentId=(await code.textContent())?.trim()??''
  expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)
  await page.locator('#assignment-gps-required').check()
  await page.getByRole('button',{name:'Подписать новые правила'}).click()
  await expect(page.getByText('Версия правил: 2')).toBeVisible({timeout:30000})
  return assignmentId
}

test('P2 #208 explicit high-accuracy GPS request, private AES-GCM capture and no plaintext network leak',async({browser})=>{
  test.setTimeout(170000)
  const context=await browser.newContext({
    permissions:['camera','geolocation'],
    geolocation:validFix,
  })
  const page=await context.newPage()
  const requests:string[]=[]
  page.on('request',request=>{
    // No sensitive value is printed. Requests are inspected inside the test.
    requests.push(request.url()+'\n'+(request.postData()??''))
  })
  try{
    await register(page)
    // Wrap the actual Chromium geolocation API, not its result or permissions.
    await page.addInitScript(()=>{
      const geo=navigator.geolocation
      const native=geo.getCurrentPosition.bind(geo)
      const calls:GeoOptions[]=[]
      Object.defineProperty(window,'__p2gpsOptions',{configurable:true,value:calls})
      Object.defineProperty(geo,'getCurrentPosition',{
        configurable:true,value:(success:PositionCallback,
          error?:PositionErrorCallback,options?:PositionOptions)=>{
          calls.push({
            enableHighAccuracy:options?.enableHighAccuracy,
            maximumAge:options?.maximumAge,timeout:options?.timeout,
          })
          return native(success,error,options)
        },
      })
    })
    await cameraReady(page)
    expect(await page.evaluate(()=>(window as any).__p2gpsOptions?.length)).toBe(0)
    await expect(page.getByText(/GPS получен/)).toHaveCount(0)
    await page.getByRole('button',{name:'Получить GPS'}).click()
    await expect(page.getByText(/GPS получен · точность/))
      .toBeVisible({timeout:20000})
    expect(await page.evaluate(()=>(window as any).__p2gpsOptions)).toEqual([{
      enableHighAccuracy:true,maximumAge:0,timeout:12000,
    }])
    await context.setOffline(true)
    await page.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(page.getByText(/Зашифровано и сохранено локально/))
      .toBeVisible({timeout:30000})
    const photos=await localPhotos(page)
    expect(photos).toHaveLength(1)
    expect(photos[0]!.assetTypes).toEqual([
      'application/octet-stream','application/octet-stream',
    ])
    expect(photos[0]!.contract).not.toContain(String(validFix.latitude))
    expect(photos[0]!.contract).not.toContain(String(validFix.longitude))
    const saved=await page.evaluate(async photoId=>{
      const m=await import('/src/features/photo-sync/application/p1-photo.ts')
      return m.readLocalPhotoMetadata(photoId)
    },photos[0]!.photoId)
    expect(saved.gps).toBeDefined()
    expect(saved.gps?.latitude).toBeCloseTo(validFix.latitude,5)
    expect(saved.gps?.longitude).toBeCloseTo(validFix.longitude,5)
    expect(saved.gps?.accuracyMeters).toBe(validFix.accuracy)
    expect(saved.gps?.recordedAt).toBeLessThanOrEqual(saved.capturedAt+2000)
    expect(saved.capturedAt-(saved.gps?.recordedAt??0))
      .toBeLessThanOrEqual(120000)
    const wire=requests.join('\n')
    expect(wire).not.toContain(String(validFix.latitude))
    expect(wire).not.toContain(String(validFix.longitude))
  }finally{await context.close()}
})

test('P2 #208 signed required-GPS policy rejects denied capture offline, then accepts genuine consent',async({browser})=>{
  test.setTimeout(200000)
  const context=await browser.newContext({
    permissions:['camera'],
    geolocation:validFix,
  })
  const page=await context.newPage()
  try{
    await register(page)
    const assignmentId=await makeSignedGpsRequiredAssignment(page)
    await cameraReady(page,assignmentId)
    await expect(page.getByText(/GPS обязателен/)).toBeVisible()
    await page.getByRole('button',{name:'Получить GPS'}).click()
    await expect(page.getByRole('alert').first()).toBeVisible({timeout:18000})
    await expect(page.getByText(/GPS получен/)).toHaveCount(0)
    await context.setOffline(true)
    await page.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(page.getByText('assignment.gps_required')).toBeVisible({timeout:30000})
    expect(await localPhotos(page)).toHaveLength(0)
    // Same signed, cached owner policy; permission is granted explicitly.
    await context.grantPermissions(['camera','geolocation'])
    await context.setGeolocation(validFix)
    await page.getByRole('button',{name:'Получить GPS'}).click()
    await expect(page.getByText(/GPS получен · точность/))
      .toBeVisible({timeout:15000})
    await page.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(page.getByText(/Зашифровано и сохранено локально/))
      .toBeVisible({timeout:30000})
    const photos=await localPhotos(page)
    expect(photos).toHaveLength(1)
    const data=await page.evaluate(async photoId=>{
      const m=await import('/src/features/photo-sync/application/p1-photo.ts')
      return m.readLocalPhotoMetadata(photoId)
    },photos[0]!.photoId)
    expect(data.assignmentCapture?.assignmentId).toBe(assignmentId)
    expect(data.assignmentCapture?.policyRevision).toBe(2)
    expect(data.assignmentCapture?.capturedAt).toBe(data.capturedAt)
    expect(data.gps?.latitude).toBeCloseTo(validFix.latitude,5)
    expect(photos[0]!.contract).not.toContain(String(validFix.latitude))
  }finally{await context.close()}
})

test('P2 #208 3-minute-old GPS provider fix fails closed even with earlier consent',async({browser})=>{
  test.setTimeout(110000)
  const context=await browser.newContext({permissions:['camera']})
  const page=await context.newPage()
  try{
    await register(page)
    // Explicit negative fixture: Chromium cannot set stale timestamps
    // through context.setGeolocation. Simulate a misbehaving provider,
    // but keep real Key-Only auth, camera, Canvas and E2EE pipelines.
    await page.addInitScript(()=>{
      Object.defineProperty(navigator.geolocation,'getCurrentPosition',{
        configurable:true,value:(resolve:PositionCallback)=>{
          resolve({
            coords:{latitude:22.418921,longitude:80.519821,accuracy:9},
            timestamp:Date.now()-181000,
          } as GeolocationPosition)
        },
      })
    })
    await cameraReady(page)
    await page.getByRole('button',{name:'Получить GPS'}).click()
    await expect(page.getByText(/GPS получен/)).toBeVisible()
    await context.setOffline(true)
    await page.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(page.getByText('capture.invalid_or_stale_gps'))
      .toBeVisible({timeout:25000})
    expect(await localPhotos(page)).toHaveLength(0)
  }finally{await context.close()}
})

test('P2 #208 revoking geolocation must invalidate old fix before another capture',async({browser})=>{
  test.setTimeout(135000)
  const context=await browser.newContext({
    permissions:['camera','geolocation'],geolocation:validFix,
  })
  const page=await context.newPage()
  try{
    await register(page)
    await cameraReady(page)
    await page.getByRole('button',{name:'Получить GPS'}).click()
    await expect(page.getByText(/GPS получен/)).toBeVisible()
    // Revoke geolocation while keeping camera. The old fix is recent,
    // so the 2-minute timestamp cutoff alone cannot protect consent.
    await context.grantPermissions(['camera'])
    // Confirm that the browser itself has actually revoked geolocation;
    // observing only an app message would not prove a permission change.
    await expect.poll(()=>page.evaluate(async()=>
      (await navigator.permissions.query({name:'geolocation'})).state,
    )).toBe('denied')
    await page.getByRole('button',{name:'Получить GPS'}).click()
    // A refused repeat must not leave prior consent/location visible even
    // if the browser never dispatches a conventional error callback.
    await expect.soft(page.getByText(/GPS получен/)).toHaveCount(0)
    await context.setOffline(true)
    await page.getByRole('button',{name:'Сделать снимок'}).click()
    await expect(page.getByText(/Зашифровано и сохранено локально/))
      .toBeVisible({timeout:30000})
    const photos=await localPhotos(page)
    expect(photos).toHaveLength(1)
    const data=await page.evaluate(async photoId=>{
      const m=await import('/src/features/photo-sync/application/p1-photo.ts')
      return m.readLocalPhotoMetadata(photoId)
    },photos[0]!.photoId)
    // A private fix must never survive explicit permission denial:
    // local AES-GCM alone does not make old consent reusable.
    expect(data.gps).toBeUndefined()
  }finally{await context.close()}
})
