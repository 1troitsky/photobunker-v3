import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {expect,test,type Page} from '@playwright/test'

/**
 * #287: two genuine Chromium→Laravel→Postgres18/Garage E2EE journeys.
 * A TEST-ONLY trusted ledger event simulates Go/Pro→Free downgrade.
 * This does NOT claim real payment expiration/grace or MFA approval.
 */
const DAY=86400000
const plans=[
  {plan:'go',paidDays:29},
  {plan:'pro',paidDays:89},
] as const

async function enroll(page:Page):Promise<string>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия'))
    .toBeVisible({timeout:30000})
  const account=await page.evaluate(async()=>{
    const {activeSession}=await import('/src/features/identity/application/session.ts')
    return activeSession.value?.accountId??''
  })
  expect(account).toMatch(/^[a-f0-9]{8}-[a-f0-9-]{27,}$/)
  return account
}

function fixture(
  name:'p1-paid-browser-entitlement-fixture.php'|'p1-paid-downgrade-fixture.php',
  accountId:string,plan:'go'|'pro',
):Record<string,unknown>{
  return JSON.parse(execFileSync('php',[
    'tests/integration/'+name,accountId,plan,
  ],{
    cwd:resolve(process.cwd(),'apps/api'),
    timeout:20000,encoding:'utf8',
  }).trim()) as Record<string,unknown>
}

for(const {plan,paidDays} of plans){
  test('P1 #287 synthetic '+plan+' to Free retains original E2EE and new Free13 writes',async({page})=>{
    test.setTimeout(160000)
    const accountId=await enroll(page)
    const paid=fixture('p1-paid-browser-entitlement-fixture.php',accountId,plan)
    expect(paid).toMatchObject({
      testOnly:true,realPaymentVerified:false,
      accountId,planId:plan,revision:2,
    })

    // Fresh new browser module session: paid plan comes only from the real
    // account-scoped server endpoint, never from a caller-provided plan.
    await page.reload()
    await expect(page.getByText('Подтверждённая сессия'))
      .toBeVisible({timeout:30000})
    const before=await page.evaluate(async()=>{
      const [auth,hint,photo,media,api]=await Promise.all([
        import('/src/features/identity/application/session.ts'),
        import('/src/features/media/application/retention-hint.ts'),
        import('/src/features/photo-sync/application/p1-photo.ts'),
        import('/src/features/media/application/media-outbox.ts'),
        import('/src/features/identity/infrastructure/api.ts'),
      ])
      const s=auth.activeSession.value
      if(!s?.online)throw Error('qa287.no_verified_session')
      await hint.refreshRetentionHint(s)
      const me=await api.jsonApi<{
        entitlement:{revision:number;effectivePlanId:string}
      }>('/billing/v1/me')

      const oldPhoto=await photo.captureEncrypted(new Blob([
        new Uint8Array(2304).fill(71)],{type:'image/jpeg'}))
      await photo.flushOutbox()
      const photoRow=(await photo.listLocalPhotos())
        .find(x=>x.photoId===oldPhoto.photoId)
      if(photoRow?.state!=='synced')
        throw Error('qa287.old_photo_not_synced:'+String(photoRow?.lastError))
      const oldMediaId=await media.enqueueEncryptedMedia(new File([
        new Uint8Array(2560).fill(34)],'original-paid.wav',
        {type:'audio/wav'}))
      await media.flushMediaOutbox()
      const mediaRow=(await media.listLocalMedia())
        .find(x=>x.mediaId===oldMediaId)
      if(mediaRow?.state!=='synced')
        throw Error('qa287.old_media_not_synced:'+String(mediaRow?.lastError))
      const originalPhotoContract=JSON.parse(photo.signedPhotoContract(photoRow)) as {
        expiresAt:number;assets:Array<{manifest:{expiresAt:number}}>
      }
      // Receipt/readback before downgrade: real trusted S3 ciphertext.
      const photoCloud=await photo.readCloudPhoto(oldPhoto.photoId)
      const mediaCloud=await media.readCloudMedia(oldMediaId)
      return {
        accountId:s.accountId,
        plan:me.entitlement.effectivePlanId,
        revision:me.entitlement.revision,
        photoId:oldPhoto.photoId,
        mediaId:oldMediaId,
        photoExpiresAt:oldPhoto.expiresAt,
        mediaExpiresAt:mediaRow.expiresAt,
        photoDays:(oldPhoto.expiresAt-oldPhoto.createdAt)/86400000,
        mediaDays:(mediaRow.expiresAt-mediaRow.createdAt)/86400000,
        manifestsSame:originalPhotoContract.expiresAt===oldPhoto.expiresAt
          &&originalPhotoContract.assets.every(
            x=>x.manifest.expiresAt===oldPhoto.expiresAt),
        photosEncrypted:photoRow.assets.every(
          x=>x.blob.type==='application/octet-stream'),
        mediaEncrypted:mediaRow.chunks.every(
          x=>x.blob.type==='application/octet-stream'),
        photoReadback:photoCloud.size===2304
          &&Array.from(new Uint8Array(await photoCloud.arrayBuffer()))
            .every(x=>x===71),
        mediaReadback:mediaCloud.blob.size===2560
          &&Array.from(new Uint8Array(await mediaCloud.blob.arrayBuffer()))
            .every(x=>x===34)
          &&mediaCloud.metadata.fileName==='original-paid.wav',
      }
    })
    expect(before).toMatchObject({
      accountId,plan,revision:2,photoDays:paidDays,mediaDays:paidDays,
      manifestsSame:true,photosEncrypted:true,mediaEncrypted:true,
      photoReadback:true,mediaReadback:true,
    })

    // Simulates a deliberate verified *operator* downgrade, not expiry.
    // It appends Free rev3 with CAS against the real verified paid rev2 head.
    const down=fixture('p1-paid-downgrade-fixture.php',accountId,plan)
    expect(down).toMatchObject({
      testOnly:true,realPaymentExpiryVerified:false,
      realAdminMFAVerified:false,
      accountId,previousPlan:plan,previousRevision:2,
      revision:3,effectivePlanId:'free',unchanged:false,
    })

    await page.reload()
    await expect(page.getByText('Подтверждённая сессия'))
      .toBeVisible({timeout:30000})

    const after=await page.evaluate(async(data)=>{
      const [auth,hint,photo,media,api]=await Promise.all([
        import('/src/features/identity/application/session.ts'),
        import('/src/features/media/application/retention-hint.ts'),
        import('/src/features/photo-sync/application/p1-photo.ts'),
        import('/src/features/media/application/media-outbox.ts'),
        import('/src/features/identity/infrastructure/api.ts'),
      ])
      const s=auth.activeSession.value
      if(!s?.online)throw Error('qa287.downgrade_session_offline')
      await hint.refreshRetentionHint(s)
      const me=await api.jsonApi<{
        entitlement:{
          revision:number;planId:string;effectivePlanId:string
          paidPrivilegesActive:boolean;status:string
          snapshotSha256:string;effectiveLimits:{retention:{days:number}}
        }
      }>('/billing/v1/me')
      const now=Date.now()
      const newHint=hint.newSignedExpiry(now,s)-now

      // No retroactive signed deadline re-evaluation for an already
      // accepted active reservation, even after paid privileges disappear.
      const oldP=(await photo.listLocalPhotos())
        .find(x=>x.photoId===data.photoId)
      const oldM=(await media.listLocalMedia())
        .find(x=>x.mediaId===data.mediaId)
      if(!oldP||!oldM)throw Error('qa287.old_local_ciphertext_lost')
      const oldContract=photo.signedPhotoContract(oldP)
      const retryPhoto=await api.jsonApi<{
        state:string;receipt?:{expiresAt:number;receiptHash:string}
      }>('/photos/v1/reserve','POST',{
        contract:oldContract,
        signature:await auth.signPhotoContract(oldContract),
      })
      const retryMedia=await api.jsonApi<{
        state:string;receipt?:{expiresAt:number;receiptHash:string}
      }>('/media/v1/reserve','POST',{
        contract:JSON.stringify(oldM.contract),signature:oldM.signature,
      })

      // Server must still expose the previous, unexpired signed ciphertext
      // and the SAME AES-GCM metadata. No hidden downgrade GC.
      const oldPhotoCloud=await photo.readCloudPhoto(data.photoId)
      const oldMediaCloud=await media.readCloudMedia(data.mediaId)

      // Only NEW files are now signed and admitted at Free13. They must
      // really upload and decrypt from Garage without altering old rows.
      const newP=await photo.captureEncrypted(new Blob([
        new Uint8Array(2304).fill(83)],{type:'image/jpeg'}))
      await photo.flushOutbox()
      const newPhotoRow=(await photo.listLocalPhotos())
        .find(x=>x.photoId===newP.photoId)
      if(newPhotoRow?.state!=='synced')
        throw Error('qa287.new_photo_not_synced:'+String(newPhotoRow?.lastError))
      const newMId=await media.enqueueEncryptedMedia(new File([
        new Uint8Array(2560).fill(47)],'new-free.wav',
        {type:'audio/wav'}))
      await media.flushMediaOutbox()
      const newMediaRow=(await media.listLocalMedia())
        .find(x=>x.mediaId===newMId)
      if(newMediaRow?.state!=='synced')
        throw Error('qa287.new_media_not_synced:'+String(newMediaRow?.lastError))
      const newPhotoCloud=await photo.readCloudPhoto(newP.photoId)
      const newMediaCloud=await media.readCloudMedia(newMId)
      const allPhotos=await photo.listCloudPhotos()
      const allMedia=await media.listCloudMedia()

      return {
        accountId:s.accountId,me:me.entitlement,
        newHint,
        old:{
          photoId:oldP.photoId,mediaId:oldM.mediaId,
          photoExpiresAt:oldP.expiresAt,mediaExpiresAt:oldM.expiresAt,
          photoReplay:retryPhoto.state,mediaReplay:retryMedia.state,
          photoReplayExpiry:retryPhoto.receipt?.expiresAt,
          mediaReplayExpiry:retryMedia.receipt?.expiresAt,
          photoReceipt:typeof retryPhoto.receipt?.receiptHash==='string',
          mediaReceipt:typeof retryMedia.receipt?.receiptHash==='string',
          cloudPhotoBytes:oldPhotoCloud.size===2304
            &&Array.from(new Uint8Array(await oldPhotoCloud.arrayBuffer()))
              .every(x=>x===71),
          cloudMediaBytes:oldMediaCloud.blob.size===2560
            &&Array.from(new Uint8Array(await oldMediaCloud.blob.arrayBuffer()))
              .every(x=>x===34)
            &&oldMediaCloud.metadata.fileName==='original-paid.wav',
          indexedPhoto:allPhotos.items.some(x=>x.photoId===oldP.photoId),
          indexedMedia:allMedia.items.some(x=>x.mediaId===oldM.mediaId),
        },
        fresh:{
          photoDays:(newP.expiresAt-newP.createdAt)/86400000,
          mediaDays:(newMediaRow.expiresAt-newMediaRow.createdAt)/86400000,
          photoState:newPhotoRow.state,
          mediaState:newMediaRow.state,
          photoCloud: newPhotoCloud.size===2304
            &&Array.from(new Uint8Array(await newPhotoCloud.arrayBuffer()))
              .every(x=>x===83),
          mediaCloud:newMediaCloud.blob.size===2560
            &&Array.from(new Uint8Array(await newMediaCloud.blob.arrayBuffer()))
              .every(x=>x===47)
            &&newMediaCloud.metadata.fileName==='new-free.wav',
          photoIndexed:allPhotos.items.some(x=>x.photoId===newP.photoId),
          mediaIndexed:allMedia.items.some(x=>x.mediaId===newMId),
        },
      }
    },{photoId:before.photoId,mediaId:before.mediaId})
    expect(after.accountId).toBe(accountId)
    expect(after.me).toMatchObject({
      revision:3,planId:'free',effectivePlanId:'free',
      paidPrivilegesActive:false,status:'active',
      snapshotSha256:down.snapshotSha256,
      effectiveLimits:{retention:{days:14}},
    })
    expect(after.newHint).toBe(13*DAY)
    expect(after.old).toMatchObject({
      photoId:before.photoId,mediaId:before.mediaId,
      photoExpiresAt:before.photoExpiresAt,
      mediaExpiresAt:before.mediaExpiresAt,
      photoReplay:'active',mediaReplay:'active',
      photoReplayExpiry:before.photoExpiresAt,
      mediaReplayExpiry:before.mediaExpiresAt,
      photoReceipt:true,mediaReceipt:true,
      cloudPhotoBytes:true,cloudMediaBytes:true,
      indexedPhoto:true,indexedMedia:true,
    })
    expect(after.fresh).toMatchObject({
      photoDays:13,mediaDays:13,
      photoState:'synced',mediaState:'synced',
      photoCloud:true,mediaCloud:true,
      photoIndexed:true,mediaIndexed:true,
    })
  })
}
