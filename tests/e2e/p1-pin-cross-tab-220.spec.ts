import {expect,test} from '@playwright/test'

/**
 * Disposable browser-only P3 #220 security acceptance: two genuinely
 * independent Vue/Identity instances sharing one IndexedDB origin.
 *
 * There is deliberately NO production PIN-enrolment UI yet. This test
 * invokes the existing unreleased migration helper on a disposable local
 * fake account only, with no server registration, no user data or wipe.
 */
test('P3-220: second-tab PIN seal locks old tab and reload needs real PIN',async({browser})=>{
  test.setTimeout(180_000)
  const ctx=await browser.newContext()
  const first=await ctx.newPage()
  const second=await ctx.newPage()
  try{
    await first.goto('/settings')
    await expect(first.getByRole('button',{name:'Создать ключ'})).toBeVisible()
    const accountId=await first.evaluate(async()=>{
      const protocol=await import('/src/features/identity/infrastructure/crypto.ts')
      const storage=await import('/src/features/identity/infrastructure/storage.ts')
      const session=await import('/src/features/identity/application/session.ts')
      const id=crypto.randomUUID()
      const pkg=(await protocol.freshPackage(id)).pkg
      const device=await storage.newLocalDevice(id)
      device.envelope=await protocol.sealDevice(
        pkg,device.deviceId,device.encryptionKey,
      )
      await storage.saveDevice(device)
      await session.resumeExistingDevice()
      if(session.activeSession.value?.accountId!==id)throw Error('test.legacy_resume_missing')
      return id
    })
    await expect(first.getByText('Локальный режим; сервер недоступен'))
      .toBeVisible()
    await expect(first.locator('.foundation-card code').first())
      .toContainText(accountId)

    // Another tab has a separate JS heap/activeSession but the same saved
    // nonextractable browser keys in IndexedDB.
    await second.goto('/settings')
    await expect(second.getByText('Локальный режим; сервер недоступен'))
      .toBeVisible()
    await second.evaluate(async(expectedId)=>{
      const session=await import('/src/features/identity/application/session.ts')
      const {migrateLegacyLocalDeviceToPin}=
        await import('/src/features/security/application/pin-device-migration.ts')
      const s=session.activeSession.value
      if(!s||s.accountId!==expectedId)throw Error('test.other_tab_session_missing')
      // A second cooperating tab closes its OWN memory, not the first tab's
      // activeSession. Real migration is still unreleased to users.
      const verifiedPackage=s.pkg
      const scope={accountId:s.accountId,deviceId:s.deviceId}
      session.activeSession.value=null
      await migrateLegacyLocalDeviceToPin({
        scope,verifiedPackage,appPin:'4826',emergencyPin:'6284',
      })
    },accountId)

    // Exactly the BroadcastChannel/IndexedDB cross-tab boundary under test:
    // tab A must never keep displaying its old decrypted account shell.
    await expect(first.getByRole('heading',{name:'Введите PIN'}))
      .toBeVisible({timeout:25_000})
    await expect(first.locator('.shell-header')).toHaveCount(0)
    await expect(first.locator('.shell-dock')).toHaveCount(0)
    await expect(first.locator('.shell-main')).toHaveCount(0)
    expect(await first.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      return session.activeSession.value===null &&
        session.pendingPinUnlock.value!==null
    })).toBe(true)

    for(const digit of '6284'){
      await first.getByRole('button',{name:'Цифра '+digit}).click()
    }
    await expect(first.getByText('Доступ не предоставлен')).toBeVisible()
    await expect(first.getByRole('heading',{name:'Введите PIN'})).toBeVisible()

    for(const digit of '4826'){
      await first.getByRole('button',{name:'Цифра '+digit}).click()
    }
    await expect(first.getByText('Локальный режим; сервер недоступен'))
      .toBeVisible({timeout:25_000})
    await expect(first.locator('.foundation-card code').first())
      .toContainText(accountId)
    // The legacy one-layer device decrypt path must no longer succeed.
    const legacyBypass=await first.evaluate(async(expectedId)=>{
      const storage=await import('/src/features/identity/infrastructure/storage.ts')
      const protocol=await import('/src/features/identity/infrastructure/crypto.ts')
      const session=await import('/src/features/identity/application/session.ts')
      const saved=session.activeSession.value?.device
      if(!saved||saved.accountId!==expectedId)
        throw Error('test.unlocked_account_mismatch')
      const row=await storage.getDevice(saved.accountId,saved.deviceId)
      if(!row)throw Error('test.no_saved_device')
      try{
        await protocol.openDevice(
          row.envelope,row.encryptionKey,row.accountId,row.deviceId,
        )
        return true
      }catch{return false}
    },accountId)
    expect(legacyBypass).toBe(false)

    await first.reload()
    await expect(first.getByRole('heading',{name:'Введите PIN'}))
      .toBeVisible({timeout:25_000})
    await expect(first.locator('.shell-dock')).toHaveCount(0)
    await expect(first.locator('.foundation-card code')).toHaveCount(0)
    expect(await first.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      return session.activeSession.value===null
    })).toBe(true)
  }finally{
    await ctx.close()
  }
})
