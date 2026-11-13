import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {expect,test} from '@playwright/test'
import type {Page} from '@playwright/test'

/**
 * #285: two REAL Chromium→Laravel→PG18/Garage ciphertext journeys.
 * Synthetic entitlement activation is strictly CI-only, never a browser
 * payment endpoint. WebCrypto/E2EE/signed HTTP/S3/receipt/readback are real.
 */
const DAY=86400000
const plans=[
  {plan:'go',days:29,serverMax:30},
  {plan:'pro',days:89,serverMax:90},
] as const

async function enroll(page:Page):Promise<string>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия'))
    .toBeVisible({timeout:30000})
  const accountId=await page.evaluate(async()=>{
    const {activeSession}=await import('/src/features/identity/application/session.ts')
    return activeSession.value?.accountId??''
  })
  expect(accountId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/)
  return accountId
}

for(const {plan,days,serverMax} of plans){
  test('P1 #285 synthetic verified '+plan+' signed '+days+'d Photo+Media E2EE to real Garage',async({page})=>{
    test.setTimeout(145000)
    const accountId=await enroll(page)
    const free=await page.evaluate(async()=>{
      const result=await fetch('/billing/v1/me',{
        credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
      })
      if(!result.ok)throw Error('billing.before_not_ok')
      return result.json() as Promise<{
        entitlement:{revision:number;effectivePlanId:string}
      }>
    })
    expect(free.entitlement).toMatchObject({
      revision:1,effectivePlanId:'free',
    })

    // Separate real PHP process against disposable CI PG18 only.
    // This is NOT an actual payment settlement or live paid account.
    const output=execFileSync('php',[
      'tests/integration/p1-paid-browser-entitlement-fixture.php',
      accountId,plan,
    ],{
      cwd:resolve(process.cwd(),'apps/api'),
      encoding:'utf8',timeout:20000,
    })
    const fixture=JSON.parse(output.trim()) as {
      testOnly:boolean;realPaymentVerified:boolean
      accountId:string;planId:string;revision:number
      snapshotSha256:string
    }
    expect(fixture).toMatchObject({
      testOnly:true,realPaymentVerified:false,
      accountId,planId:plan,revision:2,
    })
    expect(fixture.snapshotSha256).toMatch(/^[a-f0-9]{64}$/)

    // New authentication refresh invalidates cached 60s Free hint.
    await page.reload()
    await expect(page.getByText('Подтверждённая сессия'))
      .toBeVisible({timeout:30000})

    const actual=await page.evaluate(async({expectedPlan})=>{
      const [auth,hints,photo,media,api]=await Promise.all([
        import('/src/features/identity/application/session.ts'),
        import('/src/features/media/application/retention-hint.ts'),
        import('/src/features/photo-sync/application/p1-photo.ts'),
        import('/src/features/media/application/media-outbox.ts'),
        import('/src/features/identity/infrastructure/api.ts'),
      ])
      const s=auth.activeSession.value
      if(!s?.online)throw Error('paid_qa.no_authenticated_session')
      await hints.refreshRetentionHint(s)
      const me=await api.jsonApi<{
        schemaVersion:number;entitlement:{
          planId:string;effectivePlanId:string
          paidPrivilegesActive:boolean;status:string;revision:number
          snapshotSha256:string
          effectiveLimits:{retention:{days:number}}
        }
      }>('/billing/v1/me')
      if(me.entitlement.effectivePlanId!==expectedPlan)
        throw Error('paid_qa.wrong_entitlement_plan')

      // Synthetic MIME-labeled bytes: the server only ever sees AES-GCM
      // ciphertext, not the private JPEG/WAV plaintext or filenames.
      const jpeg=new Blob([new Uint8Array(2048).fill(91)],
        {type:'image/jpeg'})
      const captured=await photo.captureEncrypted(jpeg)
      const signedPhoto=JSON.parse(photo.signedPhotoContract(captured)) as {
        photoId:string;expiresAt:number
        assets:Array<{manifest:{expiresAt:number}}>
      }
      await photo.flushOutbox()
      const photoRow=(await photo.listLocalPhotos())
        .find(row=>row.photoId===captured.photoId)
      if(photoRow?.state!=='synced')
        throw Error('paid_qa.photo_not_synced:'+String(photoRow?.lastError))
      const photoCloud=await photo.readCloudPhoto(captured.photoId)

      const wav=new File([new Uint8Array(3072).fill(53)],
        'synthetic-ci-audio.wav',{type:'audio/wav'})
      const mediaId=await media.enqueueEncryptedMedia(wav)
      await media.flushMediaOutbox()
      const mediaRow=(await media.listLocalMedia())
        .find(row=>row.mediaId===mediaId)
      if(mediaRow?.state!=='synced')
        throw Error('paid_qa.media_not_synced:'+String(mediaRow?.lastError))
      const mediaCloud=await media.readCloudMedia(mediaId)

      // Lost-ACK-like second signed reservation against an already active
      // object: original contract, ID and expiration must be preserved.
      const photoContract=photo.signedPhotoContract(captured)
      const signedPhotoReplay=await auth.signPhotoContract(photoContract)
      const photoRetry=await api.jsonApi<{state:string;expiresAt:number}>(
        '/photos/v1/reserve','POST',{
          contract:photoContract,signature:signedPhotoReplay,
        })
      const mediaRetry=await api.jsonApi<{
        state:string;expiresAt:number;receipt?:unknown
      }>('/media/v1/reserve','POST',{
        contract:JSON.stringify(mediaRow.contract),
        signature:mediaRow.signature,
      })
      const photoIndex=await photo.listCloudPhotos()
      const mediaIndex=await media.listCloudMedia()

      return {
        accountId:s.accountId,
        entitlement:me.entitlement,
        photo:{
          id:captured.photoId,
          delta:captured.expiresAt-captured.createdAt,
          manifestSame:signedPhoto.assets.every(
            asset=>asset.manifest.expiresAt===captured.expiresAt),
          contractSame:signedPhoto.expiresAt===captured.expiresAt,
          state:photoRow.state,
          encrypted:captured.assets.every(asset=>
            asset.blob.type==='application/octet-stream'),
          realCloudDecrypted:photoCloud.size===2048
            &&Array.from(new Uint8Array(await photoCloud.arrayBuffer()))
              .every(byte=>byte===91),
          indexed:photoIndex.items.some(row=>row.photoId===captured.photoId),
          replay:photoRetry.state,
          replaySameExpiry:photoRetry.expiresAt===captured.expiresAt,
        },
        media:{
          id:mediaId,
          delta:mediaRow.expiresAt-mediaRow.createdAt,
          contractSame:mediaRow.contract.expiresAt===mediaRow.expiresAt,
          state:mediaRow.state,
          encrypted:mediaRow.chunks.every(
            chunk=>chunk.blob.type==='application/octet-stream'),
          realCloudDecrypted:mediaCloud.blob.size===3072
            &&Array.from(new Uint8Array(await mediaCloud.blob.arrayBuffer()))
              .every(byte=>byte===53),
          privateFilename:mediaCloud.metadata.fileName,
          indexed:mediaIndex.items.some(row=>row.mediaId===mediaId),
          replay:mediaRetry.state,
          replaySameExpiry:mediaRetry.expiresAt===mediaRow.expiresAt,
          receiptReturned:Boolean(mediaRetry.receipt),
        },
      }
    },{expectedPlan:plan})

    expect(actual.accountId).toBe(accountId)
    expect(actual.entitlement).toMatchObject({
      planId:plan,effectivePlanId:plan,
      paidPrivilegesActive:true,status:'active',revision:2,
      snapshotSha256:fixture.snapshotSha256,
      effectiveLimits:{retention:{days:serverMax}},
    })
    expect(actual.photo).toMatchObject({
      delta:days*DAY,manifestSame:true,contractSame:true,
      state:'synced',encrypted:true,realCloudDecrypted:true,
      indexed:true,replay:'active',replaySameExpiry:true,
    })
    expect(actual.media).toMatchObject({
      delta:days*DAY,contractSame:true,
      state:'synced',encrypted:true,realCloudDecrypted:true,
      privateFilename:'synthetic-ci-audio.wav',
      indexed:true,replay:'active',replaySameExpiry:true,
      receiptReturned:true,
    })
  })
}
