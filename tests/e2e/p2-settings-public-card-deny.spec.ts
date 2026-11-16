import {test,expect} from '@playwright/test'

test('Public Card 1.1: unknown and expired links fail closed without leaking metadata',async({page})=>{
  for(const url of ['/p/random-token','/p/OLD0001?scope=original&download=1&gps=1']){
    await page.goto(url)
    await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
    await expect(page.locator('.shell-header')).toHaveCount(0)
    await expect(page.locator('.shell-dock')).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Карточка недоступна'})).toBeVisible()
    await expect(page.getByText('Ссылка не найдена, срок действия истёк или доступ к файлу закрыт.',{exact:false})).toBeVisible()
    await expect(page.getByRole('button',{name:/скачать/i})).toBeDisabled()
    // The public Fieldwork header deliberately renders the brand icon.
    // Still forbid ALL media elements outside that single verified logo:
    // neither the denied card nor query-string scopes may reveal file media.
    await expect(page.locator('header.site-head .site-logo-mark img')).toHaveCount(1)
    await expect(page.locator('img')).toHaveCount(1)
    await expect(page.locator('video,audio,canvas,iframe')).toHaveCount(0)
    await expect(page.locator('main img,main video,main audio,main canvas,main iframe')).toHaveCount(0)
    await expect(page.getByText(/© 2026 /)).toBeVisible()
  }
  await page.getByRole('link',{name:'Установить приложение'}).click()
  await expect(page).toHaveURL(/\/install$/)
  await expect(page.getByTestId('install-guide-page')).toBeVisible()
})
