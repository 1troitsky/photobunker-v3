import {openImportSheet} from './helpers/browser-import'
import {sendImportedMedia} from './helpers/browser-import'
import {browserControl,browserHeader,exchangeReady} from './support/browser-ui'
import {test,expect} from '@playwright/test'

// P2 integration QA, not a substitute for physical native iOS/Android.
// The two accounts use genuine signed root/policy, key fingerprints, E2EE
// MediaFile/DEK grants, PostgreSQL18 and Garage. Never mock server receipts.
test.use({trace:'off',screenshot:'off',video:'off'})

test('P2 pre-main: mixed creation v6 → signed A/B invitation → AV E2EE grants → server progress',async({browser})=>{
  test.setTimeout(300_000)
  const ownerCtx=await browser.newContext()
  const contributorCtx=await browser.newContext()
  const A=await ownerCtx.newPage()
  const B=await contributorCtx.newPage()
  // Reviewed #358/PR #360: a hard page.goto remounts the Vue app BEFORE
  // resumeExistingDevice() finishes real local key unseal + signed proof.
  // Wait for the SAME account and device, never force online or fabricate
  // a token/receipt. The QA fix passed 3 independent cold CI runs.
  async function waitForVerifiedResume(
    page:typeof A,expected:{accountId:string;deviceId:string},
  ):Promise<void>{
    await expect.poll(()=>page.evaluate(async wanted=>{
      const {activeSession}=await import('/src/features/identity/application/session.ts')
      const current=activeSession.value
      if(current&&(current.accountId!==wanted.accountId
        ||current.deviceId!==wanted.deviceId))throw Error('qa.unexpected_identity')
      return current?.online===true
    },expected),{timeout:30_000}).toBe(true)
  }
  async function enroll(page:typeof A):Promise<{accountId:string;deviceId:string}>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
    const device=await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      const current=identity.requireSession()
      return {accountId:current.accountId,deviceId:current.deviceId}
    })
    await page.goto('/browser')
    await waitForVerifiedResume(page,device)
    await exchangeReady(page,20000)
    return device
  }
  try{
    const owner=await enroll(A)
    const contributor=await enroll(B)
    const ownerId=owner.accountId
    const recipientId=contributor.accountId
    console.log('PB3_AV_E2E stage=enrollment_done')
    // The contributor starts with two genuinely encrypted, server-synced
    // private MediaFiles. No team role grants access to either DEK.
    // Browser v3 intentionally hides MediaImportPanel in the Header upload
    // sheet. Enter through the owner-approved visible control, instead of
    // trying to click a hidden upload button until Playwright times out.
    await browserHeader(B,'upload')
    await expect(B.getByTestId('browser-import-sheet')).toBeVisible()
    const uploader=B.getByTestId('browser-import-sheet')
      .locator('.media-import-p1')
    for(const [mime,name,fill] of [
      ['audio/wav','A-B-SIGNED-ASSIGNMENT-209.wav',0x42],
      ['video/webm','A-B-SIGNED-ASSIGNMENT-209.webm',0x58],
    ] as const){
      // Bound each real encrypted media upload independently. A hung
      // IndexedDB/S3 sync must report its specific stage rather than spend
      // the whole test budget and mask the primary failure in cleanup.
      await test.step('B signed encrypted media upload '+mime,async()=>{
        console.log('PB3_AV_E2E stage=media_upload_start kind='+mime)
        await expect(uploader.getByTestId('media-import-file'))
          .toBeEnabled({timeout:30_000})
        await openImportSheet(uploader.getByTestId('media-import-file').page())
await uploader.getByTestId('media-import-file').setInputFiles({
          name,mimeType:mime,buffer:Buffer.alloc(2048,fill),
        })
        await sendImportedMedia(uploader.page())
        await B.evaluate(async()=>{
          const m=await import('/src/features/media/application/media-outbox.ts')
          await m.synchronizeMedia()
        })
        console.log('PB3_AV_E2E stage=media_upload_complete kind='+mime)
      },{timeout:90_000})
    }
    await expect.poll(()=>B.evaluate(async()=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).filter(x=>x.state==='synced').length
    }),{timeout:30_000}).toBe(2)
    console.log('PB3_AV_E2E stage=media_server_synced')

    await A.goto('/assignments')
    await waitForVerifiedResume(A,owner)
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('P2 integrated signed AV handoff')
    await A.locator('#assignment-instructions').fill('Private encrypted owner briefing')
    await A.getByRole('button',{name:'Файлы',exact:true}).click()
    await A.locator('#assignment-create-video').check()
    await A.locator('#assignment-create-video-goal').fill('2')
    await A.locator('#assignment-create-audio').check()
    await A.locator('#assignment-create-audio-goal').fill('1')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    const assignmentId=await A.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listLocalAssignmentDrafts()).find(x=>
        x.mixedCreation?.videoGoal===2&&x.mixedCreation?.audioGoal===1)
      if(!row)throw Error('qa.mixed_intent_not_durable')
      return row.id
    })
    await expect.poll(()=>A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
      const signed=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id)
      if(!signed)return 'root-pending'
      if(signed.policyRevision!==2)return 'v6-pending'
      const root=JSON.parse(signed.policyContract)
      const amendment=JSON.parse(signed.policyAmendmentContract??'{}')
      const goals=a.signedPolicyGoals(signed)
      return JSON.stringify({
        root:root.allowedMedia,policy:amendment.allowedMedia,version:amendment.version,
        video:goals.videoGoal,audio:goals.audioGoal,
      })
    },assignmentId),{timeout:70_000}).toBe(JSON.stringify({
      root:['photo'],policy:['photo','video','audio'],
      version:6,video:2,audio:1,
    }))
    console.log('PB3_AV_E2E stage=mixed_assignment_signed')

    // The assignment creator must explicitly fingerprint-pin recipient B.
    await A.goto('/assignments/'+assignmentId+'/edit')
    await waitForVerifiedResume(A,owner)
    await A.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await A.getByRole('tab',{name:'Участники'}).click()
    await A.locator('#editor-recipient-id').fill(recipientId)
    await A.getByRole('button',{name:'Проверить ключ исполнителя'}).click()
    await A.getByLabel('Я независимо сверил отпечаток').check()
    await A.getByRole('button',{name:'Подтвердить ключ'}).click()
    await expect(A.getByText('Отпечаток независимо подтверждён на этом устройстве.'))
      .toBeVisible()
    await A.getByRole('button',{name:'Отправить подписанное приглашение'}).click()
    await expect(A.getByText(/Подписанное приглашение в очереди:/))
      .toBeVisible({timeout:20_000})
    await A.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
    })
    console.log('PB3_AV_E2E stage=invitation_queued')

    await B.goto('/assignments')
    await waitForVerifiedResume(B,contributor)
    await B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    await browserControl(B,'Обновить')
    await expect(B.getByText('Приглашения',{exact:true})).toBeVisible()
    await B.getByRole('button',{name:'Ключ владельца'}).click()
    await B.getByLabel('Я сверил отпечаток владельца').check()
    await B.getByRole('button',{name:'Подтвердить владельца'}).click()
    await B.getByRole('button',{name:'Принять задание'}).click()
    await B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
    })
    // Acceptance is a separate contributor-signed durable operation.
    // The click may return before its live server ACK; do not treat an
    // optimistic local state as confirmed membership or policy authority.
    await expect.poll(()=>B.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
      const matches=(await a.listAssignmentOperations()).filter(x=>
        x.kind==='accept'&&JSON.parse(x.contract).assignmentId===id)
      return matches.at(-1)?.state??'not-queued'
    },assignmentId),{timeout:45_000}).toBe('sent')
    console.log('PB3_AV_E2E stage=contributor_accept_sent')
    await browserControl(B,'Обновить')
    // Recipient B may see only a *fresh* independently verified owner
    // policy once the acceptance is actually acknowledged by the server.
    await expect.poll(()=>B.evaluate(async({id,owner})=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id&&x.ownerAccountId===owner)
      if(!row)return null
      const goals=a.signedPolicyGoals(row)
      return {
        media:a.signedAllowedAssignmentMedia(row),
        version:row.policyRevision,video:goals.videoGoal,audio:goals.audioGoal,
      }
    },{id:assignmentId,owner:ownerId}),{timeout:45_000}).toEqual({
      media:['photo','video','audio'],version:2,video:2,audio:1,
    })
    console.log('PB3_AV_E2E stage=contributor_policy_verified')

    await B.getByRole('button',{name:'Открыть',exact:true}).first().click()
    await B.getByRole('button',{name:'Проверить ключ владельца'}).click()
    await expect(B.getByText('Владелец подтверждён')).toBeVisible()
    B.on('dialog',d=>d.accept())
    const buttons=B.getByRole('button',{name:'Отправить медиа в задание'})
    await expect(buttons).toHaveCount(2,{timeout:20_000})
    await buttons.first().click()
    await buttons.last().click()
    await expect.poll(()=>B.evaluate(async()=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      await a.flushAssignmentOutbox()
      return (await a.listAssignmentOperations()).filter(x=>
        x.kind==='media-submit'&&x.state==='sent').length
    }),{timeout:45_000}).toBe(2)
    console.log('PB3_AV_E2E stage=two_media_submits_signed')

    // Owner A sees true server-confirmed media receipts per signed kind.
    const confirmed=await expect.poll(()=>A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments())
        .find(x=>x.assignmentId===id)
      return row
        ?[row.confirmedVideoCount??-1,row.confirmedAudioCount??-1].join('/')
        :'missing'
    },assignmentId),{timeout:45_000}).toBe('1/1')
    void confirmed
    const proof=await A.evaluate(async id=>{
      const a=await import('/src/features/assignments/application/assignment-outbox.ts')
      const row=(await a.listAllServerAssignments()).find(x=>x.assignmentId===id)!
      const result=await a.listAssignmentMediaSubmissions(id)
      return {
        goals:a.signedPolicyGoals(row),
        kinds:result.items.map(x=>x.mediaType).sort(),
        grants:result.items.every(x=>typeof x.mediaGrantId==='string'),
      }
    },assignmentId)
    expect(proof).toEqual({
      goals:{photoGoal:null,videoGoal:2,audioGoal:1},
      kinds:['audio','video'],grants:true,
    })
    console.log('PB3_AV_E2E stage=all_server_receipts_verified')
  }finally{
    // Playwright destroys contexts itself after a test-wide timeout.
    // Ignore only the resulting disposal error, never an application
    // assertion or the original test-step timeout.
    await ownerCtx.close().catch(()=>{})
    await contributorCtx.close().catch(()=>{})
  }
})
