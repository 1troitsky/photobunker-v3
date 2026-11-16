import { test, expect } from '@playwright/test'

test('Fieldwork Appearance 1.3: all visual options preview, cancel and persist atomically',async({page})=>{
  test.setTimeout(120000)
  await page.goto('/settings/appearance?field=language')
  await expect(page.getByTestId('appearance-language-field')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-ui-scheme','dark')

  await page.getByTestId('appearance-theme-light').click()
  await page.getByTestId('appearance-accent-amber').click()
  await page.getByTestId('appearance-size-large').click()
  await page.getByTestId('appearance-language-en').click()
  await expect(page.locator('html')).toHaveAttribute('data-ui-scheme','light')
  await expect(page.locator('html')).toHaveAttribute('lang','en')
  await expect(page.locator('html')).toHaveCSS('--accent','#e7bb65')
  // Preview is not saved until the explicit owner-approved Save action.
  expect(await page.evaluate(()=>localStorage.getItem('pb3.appearance.v2'))).toBeNull()
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-ui-scheme','dark')
  await expect(page.locator('html')).toHaveAttribute('lang','ru')

  await page.goto('/settings/appearance?field=theme')
  await page.getByTestId('appearance-theme-light').click()
  await page.getByTestId('appearance-accent-coral').click()
  await page.getByTestId('appearance-size-small').click()
  await page.getByTestId('appearance-language-en').click()
  await page.getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(page.getByText('Сохранено на этом устройстве.')).toBeVisible()
  const saved=await page.evaluate(()=>localStorage.getItem('pb3.appearance.v2'))
  expect(JSON.parse(saved||'null')).toEqual({
    version:2,dock:['assignments','browser','camera','contacts','settings'],launch:'tasks',
    visual:{theme:'light',accent:'coral',size:'small',language:'en'},
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-ui-scheme','light')
  await expect(page.locator('html')).toHaveAttribute('lang','en')
  await expect(page.getByTestId('appearance-accent-coral')).toHaveAttribute('aria-pressed','true')
  await expect(page.getByTestId('appearance-size-small')).toHaveAttribute('aria-pressed','true')

  // Search from settings goes to the exact language field, never the generic page root.
  await page.goto('/settings/search?q=language')
  await page.getByTestId('settings-search-result-language').click()
  await expect(page).toHaveURL(/\/settings\/appearance\?field=language/)
  await expect(page.getByTestId('appearance-language-field')).toBeVisible()
})
