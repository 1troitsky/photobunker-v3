import {test,expect} from '@playwright/test'

test('P2 M-03A: two REAL PB3 browser devices → signed cross-device revoke denies PB3/Matrix API; no false Matrix remote logout',async({browser})=>{
  test.setTimeout(120000)
  const first=await browser.newContext()
  const second=await browser.newContext()
  const A=await first.newPage(),B=await second.newPage()
  let recoveryKey=''
  try{
    await A.goto('/settings')
    await A.getByRole('button',{name:'Создать ключ'}).click()
    await expect(A.locator('#generated-key')).toHaveValue(/^PB2\./)
    recoveryKey=await A.locator('#generated-key').inputValue()
    await A.getByLabel('Я сохранил ключ восстановления').check()
    await A.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    const firstDevice=await A.evaluate(async()=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      return requireSession().deviceId
    })

    // A different actual browser context recovers with a genuine PB3 root
    // proof; there is no fixture account, SQL update or mocked Identity API.
    await B.goto('/settings')
    await B.locator('#recovery-key').fill(recoveryKey)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия')).toBeVisible()
    const secondDevice=await B.evaluate(async()=>{
      const {requireSession}=await import('/src/features/identity/application/session.ts')
      return requireSession().deviceId
    })
    expect(secondDevice).not.toBe(firstDevice)
    await expect(B.getByTestId('device-revocation'))
      .toContainText(firstDevice,{timeout:15000})
    await expect(B.getByTestId('device-revocation'))
      .toContainText(secondDevice)

    // An explicit owner confirmation must precede the destructive request.
    B.once('dialog',async dialog=>{
      expect(dialog.message()).toContain('Matrix-токен')
      await dialog.accept()
    })
    await B.getByRole('button',{
      name:'Отключить от PB3 устройство '+firstDevice,
    }).click()
    await expect(B.getByRole('status')).toContainText(
      'Отзыв Matrix-токена другого устройства на homeserver не выполнен',
    )
    await expect(B.getByTestId('device-revocation'))
      .toContainText('отключено')

    // The revoked cookie remains in A's real browser; PB3 must reject it.
    const denied=await A.evaluate(async()=>{
      const opts={credentials:'same-origin' as const,cache:'no-store' as const}
      const [identity,matrix]=await Promise.all([
        fetch('/identity/v2/me',opts),
        fetch('/matrix/v1/me',opts),
      ])
      return {identity:identity.status,matrix:matrix.status}
    })
    expect(denied).toEqual({identity:401,matrix:401})
    // No claim is made about an independent Matrix homeserver bearer:
    // we have NOT revoked one or verified it remotely here.

    // PB3 device B can revoke itself, ending its session. Without a local
    // Matrix binding this test cannot claim remote token revocation.
    B.once('dialog',async dialog=>{await dialog.accept()})
    await B.getByRole('button',{
      name:'Отключить от PB3 устройство '+secondDevice,
    }).click()
    await expect(B.getByRole('status')).toContainText(
      /Matrix-токен/,
      {timeout:20000},
    )
    await expect(B.getByRole('button',{name:'Создать ключ'})).toBeVisible()
    const selfDenied=await B.evaluate(async()=>
      (await fetch('/identity/v2/me',{credentials:'same-origin'})).status)
    expect(selfDenied).toBe(401)
  }finally{
    recoveryKey='' // Do not log or retain the PB3 Recovery Key.
    await first.close();await second.close()
  }
})
