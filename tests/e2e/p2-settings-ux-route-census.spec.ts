import {test,expect} from '@playwright/test'

test('Accepted Fieldwork routes: one real account, one Shell, no missing pages',async({page})=>{
  test.setTimeout(240000)
  const runtimeErrors:string[]=[]
  page.on('pageerror',err=>runtimeErrors.push(err.message))
  await page.goto('/settings')
  const configuredBrand=await page.evaluate(async()=>{
    const {brand}=await import('/src/config/brand.ts')
    return brand.name
  })
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  // Brand white-labelling must apply to the standalone install page too.
  await page.goto('/install')
  await expect(page.getByRole('heading',{name:configuredBrand+' всегда под рукой'})).toBeVisible()
  await page.goto('/settings')

  const routes=[
    ['/assignments','assignment-monthly-usage'],
    ['/browser','browser-v3'],
    ['/camera','camera-mode-tabs'],
    ['/contacts','contacts-teams'],
    ['/messages','messages-page'],
    ['/notifications','notifications-page'],
    ['/notifications/settings','notification-settings-page'],
    ['/settings','fieldwork-settings'],
    ['/settings/profile','profile-page'],
    ['/settings/profile/edit','profile-edit'],
    ['/settings/security','security-privacy-page'],
    ['/settings/storage','data-storage-page'],
    ['/settings/payments','payments-page'],
    ['/settings/payments/checkout?plan=go&term=1','billing-checkout'],
    ['/settings/appearance','appearance-page'],
    ['/settings/search?q=pin','settings-search-page'],
    ['/settings/help','help-shell-page'],
  ] as const
  for(const [path,testId] of routes){
    await page.goto(path)
    await expect(page.locator('.shell-header'),path).toHaveCount(1)
    await expect(page.locator('.shell-dock'),path).toHaveCount(1)
    // The assignments landing page renders before the authenticated monthly
    // quota reply; route smoke must not mistake network latency for missing UI.
    const pageSurface=path==='/assignments'
      ?page.locator('.assignments-p1'):page.getByTestId(testId)
    await expect(pageSurface,path).toBeVisible({timeout:30000})
    await expect(page.locator('body'),path).not.toContainText('Internal Server Error')
    expect(page.url(),path).toContain(path.split('?')[0]!)
  }
  expect(runtimeErrors).toEqual([])
})

test('Mobile Fieldwork Shell has one header and dock across primary sections',async({page})=>{
  test.setTimeout(80000)
  await page.setViewportSize({width:390,height:844})
  for(const [path,id] of [
    ['/settings/payments/checkout?plan=go&term=12','billing-checkout'],
    ['/settings/security','security-privacy-page'],
    ['/settings/profile','profile-page'],
    ['/messages','messages-page'],
  ] as const){
    await page.goto(path)
    await expect(page.getByTestId(id)).toBeVisible()
    await expect(page.locator('.shell-header')).toHaveCount(1)
    await expect(page.locator('.shell-dock')).toHaveCount(1)
  }
})


test('Owner-approved header icons never grow into framed cards or overflow the 64px Shell',async({page})=>{
  test.setTimeout(90000)
  for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
    await page.setViewportSize(viewport)
    for(const path of ['/notifications','/settings','/contacts']){
      await page.goto(path)
      const header=page.locator('.shell-header')
      await expect(header,path).toHaveCSS('height','64px')
      const buttons=header.locator('.shell-header-actions button')
      await expect(buttons.first(),path).toBeVisible()
      const sizes=await buttons.evaluateAll(items=>items.map(button=>{
        const rect=button.getBoundingClientRect()
        const svg=button.querySelector('svg')?.getBoundingClientRect()
        return {width:rect.width,height:rect.height,
          border:getComputedStyle(button).borderTopWidth,
          iconWidth:svg?.width??0,iconHeight:svg?.height??0}
      }))
      expect(sizes.length,path).toBeGreaterThan(0)
      for(const size of sizes){
        expect(size.width,path).toBe(36)
        expect(size.height,path).toBe(36)
        expect(size.border,path).toBe('0px')
        expect(size.iconWidth,path).toBe(20)
        expect(size.iconHeight,path).toBe(20)
      }
      const clipped=await header.evaluate(el=>el.scrollWidth>el.clientWidth)
      expect(clipped,path+' '+viewport.width).toBe(false)
    }
  }
})
