import {expect,test} from '@playwright/test'

/**
 * #358: hard-navigation session readiness is not equivalent to DOM readiness.
 * This negative proof blocks the REAL signed-login challenge, never supplies
 * a mocked receipt and never promotes a local key to an online session.
 * It also proves a genuinely locked browser cannot access a session.
 */
test('P2 #358: locked and failed-proof local sessions remain fail-closed across reload',async({browser})=>{
  test.setTimeout(120_000)
  const context=await browser.newContext()
  const page=await context.newPage()
  try{
    await page.goto('/settings')
    const locked=await page.evaluate(async()=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      try{requireSession();return 'unexpected_unlocked'}
      catch(error){return (error as Error).message}
    })
    expect(locked).toBe('identity.account_locked')

    // Genuine account creation and backend proof, identical to product E2E.
    await page.getByRole('button',{name:'Создать ключ'}).click()
    await page.getByLabel('Я сохранил ключ восстановления').check()
    await page.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
    const device=await page.evaluate(async()=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      const state=requireSession()
      return {accountId:state.accountId,deviceId:state.deviceId}
    })

    // Simulate a transport outage at exactly the signed-login challenge.
    // No fake success or disabled auth guard: the bootstrap must keep the
    // cached encrypted device local-only until REAL proof becomes available.
    await page.route('**/identity/v2/challenges',route=>route.abort('failed'))
    await page.goto('/browser')
    await expect.poll(()=>page.evaluate(async wanted=>{
      const {activeSession}=await import('/src/features/identity/application/session.ts')
      const state=activeSession.value
      if(state&&(state.accountId!==wanted.accountId
        ||state.deviceId!==wanted.deviceId))throw Error('qa.unexpected_identity')
      return state===null?'locked':state.online?'unexpected_online':'local-only'
    },device),{timeout:30_000}).toBe('local-only')

    const denied=await page.evaluate(async()=>{
      const assignments=await import('/src/features/assignments/application/assignment-outbox.ts')
      try{await assignments.listAllServerAssignments();return 'unexpected_authorized'}
      catch(error){return (error as Error).message}
    })
    expect(denied).toBe('assignment.offline')

    // Only a fresh REAL signed challenge/proof can promote the same device.
    await page.unroute('**/identity/v2/challenges')
    await page.evaluate(async()=>{
      const {reauthenticate}=await import('/src/features/identity/application/session.ts')
      await reauthenticate()
    })
    const restored=await page.evaluate(async()=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      const state=requireSession()
      return {accountId:state.accountId,deviceId:state.deviceId,online:state.online}
    })
    expect(restored).toEqual({...device,online:true})
  }finally{
    await context.close()
  }
})
