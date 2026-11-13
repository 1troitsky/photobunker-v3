import {expect,test} from '@playwright/test'

/**
 * #283 The PWA must reach Laravel's REAL authenticated, read-only
 * billing/v1/me endpoint through the Vite dev proxy. No billing fixture,
 * mocked paid status, exposed recovery key or fake payment is permitted.
 */
test('P1 #283 unauthenticated billing is denied, enrolled PWA reads own Free retention cap',async({page})=>{
  test.setTimeout(100000)
  await page.goto('/settings')
  const denied=await page.evaluate(async()=>{
    const response=await fetch('/billing/v1/me',{
      credentials:'same-origin',cache:'no-store',
    })
    return {status:response.status,contentType:response.headers.get('content-type')}
  })
  expect(denied.status).toBe(401)
  expect(denied.contentType).toContain('application/json')

  // Real Key-Only enrollment, CSRF and server session; NOT a frontend mock.
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия'))
    .toBeVisible({timeout:25000})

  const authenticated=await page.evaluate(async()=>{
    const response=await fetch('/billing/v1/me',{
      credentials:'same-origin',cache:'no-store',
    })
    if(!response.ok)return {status:response.status}
    const body=await response.json() as {
      schemaVersion?:number
      entitlement?:{
        revision?:number
        effectivePlanId?:string
        paidPrivilegesActive?:boolean
        snapshotSha256?:string
        effectiveLimits?:{retention?:{days?:number}}
      }
    }
    return {
      status:response.status,
      schemaVersion:body.schemaVersion,
      plan:body.entitlement?.effectivePlanId,
      paid:body.entitlement?.paidPrivilegesActive,
      revision:body.entitlement?.revision,
      hash:body.entitlement?.snapshotSha256,
      days:body.entitlement?.effectiveLimits?.retention?.days,
    }
  })
  expect(authenticated).toMatchObject({
    status:200,schemaVersion:1,plan:'free',paid:false,revision:1,days:14,
  })
  expect(authenticated.hash).toMatch(/^[a-f0-9]{64}$/)

  // Actual browser imports (not a synthetic paid grant) still choose 13d
  // as the buffered signed expiry for a newly authenticated Free account.
  const ttl=await page.evaluate(async()=>{
    const [{activeSession},{refreshRetentionHint,newSignedExpiry}]=await Promise.all([
      import('/src/features/identity/application/session.ts'),
      import('/src/features/media/application/retention-hint.ts'),
    ])
    const session=activeSession.value
    if(!session)return null
    await refreshRetentionHint(session)
    const now=Date.now()
    return newSignedExpiry(now,session)-now
  })
  expect(ttl).toBe(13*86400000)
})
