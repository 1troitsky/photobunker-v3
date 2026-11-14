import {test,expect} from '@playwright/test'

// Real signed owner root + revision-2 policy, real database and auth.
// No test keys, screenshots or pages with recovered identity in traces.
test.use({trace:'off',screenshot:'off',video:'off'})

test('P2 #209: mixed photo/video/audio creation is durable offline, two owner signatures, two live server ACKs',async({browser})=>{
  test.setTimeout(240_000)
  const ctx=await browser.newContext()
  const page=await ctx.newPage()
  try{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    await page.goto('/browser')
    await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible({timeout:20_000})
    await page.goto('/assignments')
    await page.getByRole('button',{name:'Создать задание'}).click()
    await page.locator('#assignment-title').fill('P2-209 real signed mixed assignment')
    await page.locator('#assignment-instructions').fill('Encrypted instructions 209')
    await page.locator('#assignment-goal').fill('2')
    await page.locator('#assignment-create-video').check()
    await page.locator('#assignment-create-video-goal').fill('3')
    await page.locator('#assignment-create-audio').check()
    await page.locator('#assignment-create-audio-goal').fill('4')
    // Disconnect while already authenticated; cold-offline boot is not
    // supported and never claimed. No network-dependent create success.
    await ctx.setOffline(true)
    await page.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    const queued=await page.evaluate(async()=>{
      const outbox=await import('/src/features/assignments/application/assignment-outbox.ts')
      const local=(await outbox.listLocalAssignmentDrafts())
        .find(x=>x.mixedCreation?.allowedMedia.length===3)
      if(!local)throw Error('qa.mixed_durable_intent_missing')
      const ops=await outbox.listAssignmentOperations()
      return {
        id:local.id,localState:local.state,
        types:local.mixedCreation?.allowedMedia,
        videoGoal:local.mixedCreation?.videoGoal,
        audioGoal:local.mixedCreation?.audioGoal,
        operations:ops.filter(op=>op.kind==='create'
          &&JSON.parse(op.contract).assignmentId===local.id).map(op=>op.state),
        noPrivateTitleInLocal:!JSON.stringify(local).includes('P2-209 real signed mixed assignment'),
      }
    })
    expect(queued.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(queued.types).toEqual(['photo','video','audio'])
    expect([queued.videoGoal,queued.audioGoal]).toEqual([3,4])
    expect(queued.noPrivateTitleInLocal).toBe(true)
    expect(queued.operations).toEqual(['queued'])
    expect(queued.localState).toBe('queued')
    await expect(page.getByTestId('assignment-mixed-pending-'+queued.id))
      .toContainText('ещё не подтверждена сервером')

    await ctx.setOffline(false)
    await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      if(!identity.requireSession().online)throw Error('qa.owner_session_not_online')
    })
    await expect(page.getByRole('button',{name:'Синхронизировать'})).toBeVisible()
    await page.getByRole('button',{name:'Синхронизировать'}).click()
    await expect.poll(async()=>page.evaluate(async id=>{
      const outbox=await import('/src/features/assignments/application/assignment-outbox.ts')
      await outbox.flushAssignmentOutbox()
      const rows=await outbox.listAllServerAssignments()
      const row=rows.find(item=>item.assignmentId===id)
      if(!row)return 'root-unconfirmed'
      if(row.policyRevision!==2)return 'policy-unconfirmed'
      if(JSON.parse(row.policyAmendmentContract??'{}').version!==6)
        return 'not-v6'
      if(JSON.stringify(outbox.signedAllowedAssignmentMedia(row))
        !==JSON.stringify(['photo','video','audio']))return 'not-mixed'
      const goals=outbox.signedPolicyGoals(row)
      return goals.videoGoal===3&&goals.audioGoal===4?'accepted':'wrong-goals'
    },queued.id),{timeout:90_000}).toBe('accepted')

    const accepted=await page.evaluate(async id=>{
      const outbox=await import('/src/features/assignments/application/assignment-outbox.ts')
      await outbox.flushAssignmentOutbox()
      await outbox.flushAssignmentOutbox()
      const row=(await outbox.listAllServerAssignments())
        .find(x=>x.assignmentId===id)!
      const root=JSON.parse(row.policyContract)
      const revised=JSON.parse(row.policyAmendmentContract!)
      const ops=(await outbox.listAssignmentOperations()).filter(op=>
        JSON.parse(op.contract).assignmentId===id)
      const local=(await outbox.listLocalAssignmentDrafts()).find(x=>x.id===id)
      return {
        rootMedia:root.allowedMedia,
        revisedMedia:revised.allowedMedia,
        revision:row.policyRevision,
        signedRevision:revised.toPolicyRevision,
        photos:row.photoGoal,
        video:outbox.signedPolicyGoals(row).videoGoal,
        audio:outbox.signedPolicyGoals(row).audioGoal,
        policyOperations:ops.filter(x=>x.kind==='policy').map(x=>x.state),
        rootOperations:ops.filter(x=>x.kind==='create').map(x=>x.state),
        localIntentCleared:local?.mixedCreation===undefined,
        localPrivateNotLeaked:!JSON.stringify(local).includes('Encrypted instructions 209'),
      }
    },queued.id)
    expect(accepted).toEqual({
      rootMedia:['photo'],revisedMedia:['photo','video','audio'],
      revision:2,signedRevision:2,photos:2,video:3,audio:4,
      policyOperations:['sent'],rootOperations:['sent'],
      localIntentCleared:true,localPrivateNotLeaked:true,
    })
    // A normal online reload must retain server-accepted v6 authority and
    // MUST NOT recreate or double-submit an already ACKed policy.
    await page.reload()
    await page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
    })
    const persisted=await page.evaluate(async id=>{
      const outbox=await import('/src/features/assignments/application/assignment-outbox.ts')
      await outbox.flushAssignmentOutbox()
      const rows=await outbox.listAllServerAssignments()
      const row=rows.find(x=>x.assignmentId===id)!
      return {
        revision:row.policyRevision,
        allowed:outbox.signedAllowedAssignmentMedia(row),
        pending:(await outbox.listPendingMixedCreations())
          .some(x=>x.assignmentId===id),
        extraOps:(await outbox.listAssignmentOperations()).filter(op=>op.kind==='policy'
          &&JSON.parse(op.contract).assignmentId===id).length,
      }
    },queued.id)
    expect(persisted).toEqual({
      revision:2,allowed:['photo','video','audio'],pending:false,extraOps:1,
    })
  }finally{await ctx.close()}
})
