import {expect,test} from '@playwright/test'

/** Real Key-Only registration; do not replace auth/session with a test shim. */
async function register(page:import('@playwright/test').Page):Promise<void>{
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByTestId('fieldwork-settings')).toBeVisible()
}

const dock=(page:import('@playwright/test').Page)=>
  page.getByRole('navigation',{name:'Главная навигация'})

const shellNames=async(page:import('@playwright/test').Page)=>
  dock(page).locator('a small').allTextContents()

test('P2 #214 mobile 320px: three/four/five real Dock routes, offline save, reload and Cancel',async({browser})=>{
  test.setTimeout(180000)
  const context=await browser.newContext({
    viewport:{width:320,height:690},isMobile:true,hasTouch:true,
  })
  const page=await context.newPage()
  try{
    await register(page)
    await expect(dock(page).getByRole('link')).toHaveCount(5)
    await page.getByTestId('settings-nav-appearance').click()
    await expect(page.getByTestId('appearance-page')).toBeVisible()

    // Seven UX choices exist, but only FIVE implemented destinations.
    // Never simulate a sixth working link or approve missing Matrix routes.
    await expect(page.getByTestId('dock-add-notifications')).toBeDisabled()
    await expect(page.getByTestId('dock-add-messages')).toBeDisabled()
    await expect(page.getByTestId('dock-remove-settings')).toHaveCount(0)

    await page.getByTestId('dock-remove-contacts').click()
    await page.getByTestId('dock-remove-camera').click()
    await expect(page.getByTestId('dock-count')).toHaveText('3 / 6')
    await expect(dock(page).getByRole('link')).toHaveCount(3)
    await expect(page.getByTestId('dock-remove-browser')).toBeDisabled()
    expect(await shellNames(page)).toEqual(['Задания','Browser','Настройки'])
    await expect(page.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled()
    // Offline mutation is local and must remain durable; no fake server ACK.
    await context.setOffline(true)
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(page.getByText('Сохранено на этом устройстве.')).toBeVisible()
    expect(await page.evaluate(()=>JSON.parse(
      localStorage.getItem('pb3.appearance.v2')||'null',
    ))).toEqual({
      version:2,dock:['assignments','browser','settings'],launch:'tasks',
    })
    // A cold HTTP reload offline is NOT asserted: the separate signed PWA
    // bootstrap/last-known-good functionality has not been accepted.
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByTestId('dock-count')).toHaveText('3 / 6')
    expect(await shellNames(page)).toEqual(['Задания','Browser','Настройки'])

    // Keyboard-only order change: the Up control is reachable/activatable.
    await page.getByTestId('dock-add-camera').click()
    await expect(page.getByTestId('dock-count')).toHaveText('4 / 6')
    await page.getByTestId('dock-up-camera').focus()
    await expect(page.getByTestId('dock-up-camera')).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Настройки',
    ])
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await page.reload()
    await expect(dock(page).getByRole('link')).toHaveCount(4)
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Настройки',
    ])

    // Cancel must revert the real Shell preview, not leave hidden dirty state.
    await page.getByTestId('dock-add-contacts').click()
    await expect(page.getByTestId('dock-count')).toHaveText('5 / 6')
    await expect(dock(page).getByRole('link')).toHaveCount(5)
    await page.getByRole('button',{name:'Отмена',exact:true}).click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Настройки',
    ])
    await page.reload()
    await expect(dock(page).getByRole('link')).toHaveCount(4)

    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('dock-add-contacts').click()
    await expect(page.getByTestId('dock-count')).toHaveText('5 / 6')
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await page.reload()
    await expect(page.getByTestId('dock-count')).toHaveText('5 / 6')
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Настройки','Контакты',
    ])

    // Narrow viewport must not clip a real route, shift Dock or form
    // unequal hit areas while moving from 3 to 5 actions.
    const geometry=await dock(page).evaluate(element=>{
      const nav=element.getBoundingClientRect()
      const rectangles=[...element.querySelectorAll('a')]
        .map(item=>item.getBoundingClientRect())
      const widths=rectangles.map(rect=>rect.width)
      return {
        count:rectangles.length,
        equal:Math.max(...widths)-Math.min(...widths)<1.1,
        inside:rectangles.every(rect=>rect.left>=-1
          &&rect.right<=window.innerWidth+1),
        bottom:Math.abs(nav.bottom-window.innerHeight)<5,
      }
    })
    expect(geometry).toEqual({count:5,equal:true,inside:true,bottom:true})
  }finally{await context.close()}
})

test('P2 #214 keyboard drag, mandatory Profile and rollback of draft order',async({browser})=>{
  test.setTimeout(150000)
  const context=await browser.newContext({viewport:{width:900,height:760}})
  const page=await context.newPage()
  try{
    await register(page)
    await page.getByTestId('settings-nav-appearance').click()
    // No removal action for mandatory Profile, but it may move to first.
    await expect(page.getByTestId('dock-remove-settings')).toHaveCount(0)
    await page.getByTestId('dock-up-settings').focus()
    await page.keyboard.press('Enter')
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Настройки','Контакты',
    ])
    // Pointer drag provides an independent order path on non-touch desktop.
    await page.getByTestId('dock-row-settings')
      .dragTo(page.getByTestId('dock-row-assignments'))
    await expect.poll(async()=>shellNames(page)).toEqual([
      'Настройки','Задания','Browser','Камера','Контакты',
    ])
    // No account/storage write without explicit Save.
    expect(await page.evaluate(()=>localStorage.getItem('pb3.appearance.v2')))
      .toBeNull()
    await page.getByRole('button',{name:'Отмена',exact:true}).click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Контакты','Настройки',
    ])
    await page.reload()
    expect(await shellNames(page)).toEqual([
      'Задания','Browser','Камера','Контакты','Настройки',
    ])
  }finally{await context.close()}
})

test('P2 #214 mobile RU/EN Dock search focus, retap one-level and hidden-section navigation',async({browser})=>{
  test.setTimeout(170000)
  const context=await browser.newContext({
    viewport:{width:375,height:780},isMobile:true,hasTouch:true,
  })
  const page=await context.newPage()
  try{
    await register(page)
    const navigation=dock(page)
    const settings=navigation.getByRole('link',{name:'Настройки',exact:true})
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('dock-remove-contacts').click()
    await page.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(navigation.getByRole('link',{name:'Контакты'})).toHaveCount(0)
    // Removing Contacts from the shortcut Dock never revokes the
    // Settings hub route or permission to access the real module.
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByTestId('settings-nav-contacts-teams').click()
    await expect(page).toHaveURL(/\/contacts$/)
    await expect(page.getByTestId('contacts-teams')).toBeVisible()
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)

    await page.locator('.shell-header')
      .getByRole('button',{name:'Поиск по настройкам'}).click()
    const input=page.getByTestId('settings-search-input')
    await expect(input).toBeFocused()
    await input.fill('панель')
    await expect(page.getByTestId('settings-search-result-dock')).toBeVisible()
    await page.getByTestId('settings-search-result-dock').click()
    await expect(page).toHaveURL(/\/settings\/appearance\?field=dock$/)
    await expect(page.getByTestId('appearance-dock-field')).toBeFocused()
    // A retap of active Settings returns to actual Search, not arbitrary
    // history nor directly to root; query and focus must survive.
    await settings.click()
    await expect(page).toHaveURL(/\/settings\/search\?q=панель$/)
    await expect(input).toHaveValue('панель')
    await expect(input).toBeFocused()
    await input.fill('navigation')
    await expect(page.getByTestId('settings-search-result-dock')).toBeVisible()
    await page.getByTestId('settings-search-result-dock').click()
    await expect(page.getByTestId('appearance-dock-field')).toBeFocused()
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\/search\?q=navigation$/)
    await expect(input).toHaveValue('navigation')
    await expect(input).toBeFocused()

    // A locale keyword is indexed, but the actual language control is
    // explicitly unavailable; it must not navigate to a false target.
    await input.fill('language')
    await expect(page.getByTestId('settings-search-pending-language'))
      .toBeVisible()
    await expect(page.getByRole('link',{name:'Язык'})).toHaveCount(0)
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    const position=await page.evaluate(()=>window.history.state?.position)
    await settings.click()
    await expect(page).toHaveURL(/\/settings$/)
    expect(await page.evaluate(()=>window.history.state?.position))
      .toBe(position)
  }finally{await context.close()}
})
