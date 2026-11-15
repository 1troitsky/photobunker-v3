import {test,expect} from '@playwright/test'

test('Checkout 1.0: real catalog price, edit order and no fake DePay success',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/settings/payments/checkout?plan=go&term=6&status=success&amount=1')
  await expect(page.getByTestId('billing-checkout')).toBeVisible()
  await expect(page.locator('.shell-header')).toHaveCount(1)
  await expect(page.locator('.shell-dock')).toHaveCount(1)
  await expect(page.getByTestId('checkout-order')).toBeVisible()
  const response=await page.evaluate(async()=>{
    const r=await fetch('/billing/v1/plans',{credentials:'include'})
    if(!r.ok)throw Error('catalog unavailable')
    return r.json()
  }) as {plans:{planId:string;periodPricesCents:Record<string,number>}[]}
  const go=response.plans.find(x=>x.planId==='go')
  if(!go)throw Error('Go missing')
  await expect(page.getByTestId('checkout-total'))
    .toHaveText('$'+(go.periodPricesCents['6']!/100).toFixed(2))
  await expect(page.getByTestId('checkout-pay')).toBeDisabled()
  await expect(page.getByTestId('checkout-no-invoice')).toContainText('не инвойс')

  await page.getByTestId('checkout-edit-order').click()
  await expect(page.getByTestId('checkout-editor')).toBeVisible()
  await page.getByTestId('checkout-plan-pro').click()
  await page.getByTestId('checkout-term-12').click()
  await page.getByTestId('checkout-apply').click()
  await expect(page).toHaveURL(/\/settings\/payments\/checkout\?plan=pro&term=12$/)
  const pro=response.plans.find(x=>x.planId==='pro')
  if(!pro)throw Error('Pro missing')
  await expect(page.getByTestId('checkout-total'))
    .toHaveText('$'+(pro.periodPricesCents['12']!/100).toFixed(2))
  await expect(page.getByTestId('checkout-pay')).toBeDisabled()
  await page.reload()
  await expect(page.getByTestId('checkout-total'))
    .toHaveText('$'+(pro.periodPricesCents['12']!/100).toFixed(2))
})

test('Checkout 1.0: unsupported URL prices and fake status cannot activate payment',async({page})=>{
  await page.goto('/settings/payments/checkout?plan=admin&term=999&paid=true&amount=0')
  await expect(page.getByTestId('checkout-order')).toBeVisible()
  await expect(page.getByTestId('checkout-pay')).toBeDisabled()
  await expect(page.getByText('Оплата сейчас недоступна.')).toBeVisible()
  await expect(page.getByText('Оплачено',{exact:true})).toHaveCount(0)
})
