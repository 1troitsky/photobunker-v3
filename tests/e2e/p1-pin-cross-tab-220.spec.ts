import {expect,test} from '@playwright/test'

/**
 * Disposable browser-only P3 #220 security acceptance: two genuinely
 * independent Vue/Identity instances sharing one IndexedDB origin.
 *
 * There is deliberately NO production PIN-enrolment UI yet. This test
 * invokes the existing unreleased migration helper on a disposable local
 * fake account only, with no server registration, no user data or wipe.
 */
test('P3-220: live tab blocks PIN seal; cooperative closure allows guarded PIN + reload',async({browser})=>{
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
    const blocked=await second.evaluate(async(expectedId)=>{
      const session=await import('/src/features/identity/application/session.ts')
      const {migrateLegacyLocalDeviceToPin}=
        await import('/src/features/security/application/pin-device-migration.ts')
      const s=session.activeSession.value
      if(!s||s.accountId!==expectedId)throw Error('test.other_tab_session_missing')
      const verifiedPackage=s.pkg
      const scope={accountId:s.accountId,deviceId:s.deviceId}
      // Tab B releases its own SHARED lock, but tab A stays active.
      session.activeSession.value=null
      try{
        await migrateLegacyLocalDeviceToPin({
          scope,verifiedPackage,appPin:'4826',emergencyPin:'6284',
        })
        return 'UNSAFE_MIGRATION_SUCCEEDED'
      }catch(error){
        return error instanceof Error?error.message:'test.unknown_migration_error'
      }
    },accountId)
    expect(blocked).toBe('pin.other_tab_active')
    await expect(first.getByText('Локальный режим; сервер недоступен'))
      .toBeVisible()

    // Cooperating tab A explicitly closes its volatile local Session.
    // No server signout, local wipe or data deletion occurs.
    await first.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      if(!session.activeSession.value)throw Error('test.first_tab_already_closed')
      session.activeSession.value=null
    })

    await second.evaluate(async(expectedId)=>{
      const session=await import('/src/features/identity/application/session.ts')
      const {migrateLegacyLocalDeviceToPin}=
        await import('/src/features/security/application/pin-device-migration.ts')
      const saved=await session.resumeExistingDevice()
      if(!saved||saved.accountId!==expectedId)
        throw Error('test.second_tab_resume_missing')
      const verifiedPackage=saved.pkg
      const scope={accountId:saved.accountId,deviceId:saved.deviceId}
      session.activeSession.value=null
      const lockName='pb3:identity:pin-migration:v1:'+
        scope.accountId+':'+scope.deviceId
      let free=false
      for(let i=0;i<100;i++){
        const query=await navigator.locks.query()
        if(!query.held?.some(lock=>lock.name===lockName)){
          free=true;break
        }
        await new Promise(resolve=>setTimeout(resolve,10))
      }
      if(!free)throw Error('test.device_lease_not_released')
      await migrateLegacyLocalDeviceToPin({
        scope,verifiedPackage,appPin:'4826',emergencyPin:'6284',
      })
    },accountId)

    // A reload starts without an unlocked Session and must request PIN.
    await first.reload()
    // Older/unpatched windows and copied PackageV2 are OUTSIDE this test.
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

    // Real browser tab background/foreground: an already PIN-unlocked
    // account must immediately clear local activeSession and show the
    // fullscreen PIN Shell (default Immediately). No server logout/wipe.
    await second.bringToFront()
    const actuallyHidden=await first.evaluate(
      ()=>document.visibilityState==='hidden',
    )
    await first.bringToFront()
    // Headless Chromium can keep both pages visible when bringToFront()
    // changes activation rather than visibility. In that case exercise
    // the real pagehide listener explicitly in the real browser context.
    // The synthetic event is NOT a native iOS/Android background test.
    if(!actuallyHidden){
      await first.evaluate(()=>window.dispatchEvent(new Event('pagehide')))
    }
    await expect(first.getByRole('heading',{name:'Введите PIN'}))
      .toBeVisible({timeout:15_000})
    await expect(first.locator('.shell-header')).toHaveCount(0)
    await expect(first.locator('.shell-main')).toHaveCount(0)
    await expect(first.locator('.shell-dock')).toHaveCount(0)
    expect(await first.evaluate(async()=>{
      const session=await import('/src/features/identity/application/session.ts')
      return session.activeSession.value===null &&
        session.pendingPinUnlock.value!==null
    })).toBe(true)

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
