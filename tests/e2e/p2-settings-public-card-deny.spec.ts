import {test,expect} from '@playwright/test'

test('Public Card 1.1: unknown and expired links fail closed without leaking metadata',async({page})=>{
  for(const url of ['/p/random-token','/p/OLD0001?scope=original&download=1&gps=1']){
    await page.goto(url)
    await expect(page.getByTestId('public-card-unavailable')).toBeVisible()
    await expect(page.locator('.shell-header')).toHaveCount(0)
    await expect(page.locator('.shell-dock')).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Карточка недоступна'})).toBeVisible()
    await expect(page.getByText('Никакие данные файла по этой ссылке не раскрываются.',{exact:false})).toBeVisible()
    await expect(page.getByRole('button',{name:/скачать/i})).toHaveCount(0)
    await expect(page.locator('img,video,audio,canvas,iframe')).toHaveCount(0)
    await expect(page.getByText('© 2026 PhotoBunker')).toBeVisible()
  }
  await page.getByTestId('public-card-install').click()
  await expect(page).toHaveURL(/\/install$/)
  await expect(page.getByTestId('install-guide-page')).toBeVisible()
})
