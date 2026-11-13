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

// Product regression addition to the unmodified QA #258 test file.
for(const required of [false,true]){
  test('Issue #260 revoke between fix and shutter without re-request; required='+required,async({browser})=>{
    test.setTimeout(200000)
    const context=await browser.newContext({permissions:['camera','geolocation'],geolocation:validFix})
    const page=await context.newPage()
    try{
      await register(page)
      const assignmentId=required?await makeSignedGpsRequiredAssignment(page):undefined
      await cameraReady(page,assignmentId)
      await page.getByRole('button',{name:'Получить GPS'}).click()
      await expect(page.getByText(/GPS получен/)).toBeVisible()
      await context.clearPermissions()
      await context.grantPermissions(['camera'])
      await expect.poll(()=>page.evaluate(async()=>
        (await navigator.permissions.query({name:'geolocation'})).state)).not.toBe('granted')
      // No second GPS button click: real browser event OR shutter recheck
      // must enforce withdrawal, not just the original request catch branch.
      await context.setOffline(true)
      await page.getByRole('button',{name:'Сделать снимок'}).click()
      if(required){
        await expect(page.getByText('assignment.gps_required')).toBeVisible()
        expect(await localPhotos(page)).toHaveLength(0)
      }else{
        await expect(page.getByText(/Зашифровано и сохранено локально/)).toBeVisible({timeout:30000})
        const photos=await localPhotos(page)
        expect(photos).toHaveLength(1)
        const data=await page.evaluate(async id=>{
          const m=await import('/src/features/photo-sync/application/p1-photo.ts')
          return m.readLocalPhotoMetadata(id)
        },photos[0]!.photoId)
        expect(data.gps).toBeUndefined()
      }
      await expect(page.getByText(/GPS получен/)).toHaveCount(0)
    }finally{await context.close()}
  })
}
