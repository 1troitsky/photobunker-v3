import {test,expect} from '@playwright/test'

test('P2 assignment: signed owner-only field ceiling, queued offline revision and NO public grant',async({browser})=>{
  test.setTimeout(190000)
  const ownerCtx=await browser.newContext()
  const outsiderCtx=await browser.newContext()
  const A=await ownerCtx.newPage()
  const B=await outsiderCtx.newPage()
  async function enroll(page:typeof A):Promise<string>{
    await page.goto('/settings')
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    return page.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.requireSession().accountId
    })
  }
  try{
    const accountId=await enroll(A)
    await enroll(B)
    await A.goto('/assignments')
    await A.getByRole('button',{name:'Создать задание'}).click()
    await A.locator('#assignment-title').fill('Private future-public assignment')
    await A.locator('#assignment-instructions')
      .fill('No public card, no original rights')
    await A.getByRole('button',{name:'Создать зашифрованное задание'}).click()
    await A.getByRole('button',{name:'Синхронизировать'}).click()
    await expect(A.locator('.assignment-detail code').first()).toBeVisible()
    const assignmentId=(await A.locator('.assignment-detail code').first()
      .textContent())?.trim()??''
    expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)

    await A.getByTestId('open-fieldwork-editor').click()
    await expect(A.getByTestId('fieldwork-assignment-editor')).toBeVisible()
    await A.getByRole('tab',{name:'Правила'}).click()
    const ceiling=A.getByTestId('assignment-preview-ceiling')
    await expect(ceiling).toBeVisible()
    await expect(ceiling.getByText('Ревизия 0')).toBeVisible()
    await expect(ceiling.getByTestId('assignment-preview-field-gps'))
      .not.toBeChecked()
    // Recording requirements MUST NOT turn into public disclosure.
    const captureGps=A.getByLabel('GPS обязателен').first()
    await captureGps.check()
    await A.getByRole('button',{name:'Подписать и сохранить'}).click()
    await expect(A.getByText('Изменение подписано и принято сервером.'))
      .toBeVisible({timeout:20000})
    await expect(ceiling.getByTestId('assignment-preview-field-gps'))
      .not.toBeChecked()

    await ceiling.getByTestId('assignment-preview-field-description').check()
    await ceiling.getByTestId('assignment-preview-field-tags').check()
    await expect(ceiling.getByTestId('assignment-preview-save')).toBeEnabled()
    await ceiling.getByTestId('assignment-preview-save').click()
    await expect(ceiling.getByText(
      'Подписанный черновик потолка задания сохранён. Публичный доступ выключен.',
    )).toBeVisible({timeout:30000})
    await expect(ceiling.getByText('Ревизия 1')).toBeVisible()
    const first=await A.evaluate(async id=>{
      const response=await fetch('/assignments/v1/'+id+'/preview-ceiling')
      const data=await response.json()
      const c=JSON.parse(data.contract)
      return {http:response.status,contract:c,
        published:data.published,hash:data.policyHash,
        leaked:JSON.stringify(data).includes('publicUrl')
          ||JSON.stringify(data).includes('envelope'),
      }
    },assignmentId)
    expect(first.http).toBe(200)
    expect(first.published).toBe(false)
    expect(first.leaked).toBe(false)
    expect(first.contract).toMatchObject({
      ownerAccountId:accountId,assignmentId,version:1,
      fromRevision:0,toRevision:1,publication:'disabled',
      fields:{description:true,tags:true,gps:false},
      actions:{view:false,copy:false,download:false,share:false},
    })
    const outsider=await B.evaluate(async id=>{
      const [policy,assignments,grants]=await Promise.all([
        fetch('/assignments/v1/'+id+'/preview-ceiling'),
        fetch('/assignments/v1'),
        fetch('/media-shares/v1/received'),
      ])
      return {
        policy:policy.status,
        assignments:(await assignments.json()).items.length,
        recipientGrants:(await grants.json()).items.length,
      }
    },assignmentId)
    expect(outsider).toEqual({policy:404,assignments:0,recipientGrants:0})

    // Saving while offline retains signed queue, not a simulated cloud ACK.
    await ownerCtx.setOffline(true)
    await ceiling.getByTestId('assignment-preview-field-tags').uncheck()
    await ceiling.getByTestId('assignment-preview-field-gps').check()
    await ceiling.getByTestId('assignment-preview-save').click()
    await expect(ceiling.getByText(
      'Подписанный черновик ожидает синхронизации. Публичный доступ выключен.',
    )).toBeVisible({timeout:30000})
    const pending=await A.evaluate(async id=>{
      const p=await import('/src/features/assignments/application/assignment-preview-ceiling.ts')
      return {state:await p.assignmentPreviewCeilingState(id),
        contract:(await p.loadAssignmentPreviewCeiling(
          (await (await import('/src/features/assignments/application/assignment-outbox.ts'))
            .listCachedAssignmentSnapshots()).find(row=>row.assignmentId===id)!,
        )).contract,
      }
    },assignmentId)
    expect(pending.state).toBe('queued')
    expect(pending.contract?.toRevision).toBe(2)
    await ownerCtx.setOffline(false)
    await A.evaluate(async()=>{
      const auth=await import('/src/features/identity/application/session.ts')
      await auth.reauthenticate()
      const p=await import('/src/features/assignments/application/assignment-preview-ceiling.ts')
      await p.flushAssignmentPreviewCeilings()
    })
    await ceiling.getByTestId('assignment-preview-refresh').click()
    await expect(ceiling.getByText('Ревизия 2')).toBeVisible({timeout:30000})
    const final=await A.evaluate(async id=>{
      const response=await fetch('/assignments/v1/'+id+'/preview-ceiling')
      const data=await response.json()
      const value=JSON.parse(data.contract)
      return {
        status:response.status,revision:data.revision,
        published:data.published,
        fields:value.fields,actions:value.actions,
        previousHash:value.previousPolicyHash,
      }
    },assignmentId)
    expect(final).toMatchObject({
      status:200,revision:2,published:false,
      fields:{description:true,tags:false,gps:true},
      actions:{view:false,copy:false,download:false,share:false},
      previousHash:first.hash,
    })
    expect((await B.evaluate(async id=>{
      const p=await fetch('/assignments/v1/'+id+'/preview-ceiling')
      return p.status
    },assignmentId))).toBe(404)
    const grantCount=await A.evaluate(async()=>{
      const p=await import('/src/features/media/application/media-grants.ts')
      return (await p.listOutgoingMediaGrants()).length
    })
    expect(grantCount).toBe(0)
  }finally{
    await ownerCtx.close()
    await outsiderCtx.close()
  }
})
