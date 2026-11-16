import {test,expect} from '@playwright/test'

test('Contacts & Teams 1.1: real encrypted team opens its own card without assuming server rights',async({page})=>{
  test.setTimeout(120000)
  await page.setViewportSize({width:390,height:844})
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/contacts')
  await page.getByRole('button',{name:/^Команды \(/}).click()
  await expect(page.getByTestId('team-membership-panel')).toBeVisible()
  await page.getByRole('button',{name:'Создать команду'}).click()
  await page.getByTestId('team-name').fill('PRIVATE TEAM UX')
  await page.getByLabel('Описание').first().fill('Only encrypted members')
  await page.getByTestId('team-create-submit').click()
  const row=page.getByTestId(/^team-row-/)
  await expect(row.getByTestId(/^team-open-/)).toBeVisible({timeout:20000})
  await row.getByTestId(/^team-open-/).click()
  const profile=page.getByTestId('team-profile')
  await expect(profile.getByTestId('team-profile-name')).toHaveText('PRIVATE TEAM UX')
  await expect(profile.getByTestId('team-profile-description')).toHaveText('Only encrypted members')
  await expect(profile.getByTestId('team-profile-members')).toContainText('Участники:')
  const delivery=profile.getByTestId('team-profile-delivery')
  await expect(delivery).toContainText(/Подтверждено сервером|подтверждение сервера ожидается|Конфликт/)
  // Management UI appears only after a verifiable remote ACK, not because
  // the card exists or the local owner name was decrypted.
  if(await delivery.textContent()!==null
    &&(await delivery.textContent())?.includes('Подтверждено сервером')){
    await page.getByTestId('team-profile-settings').click()
    await expect(profile.getByTestId('team-membership-panel')).toBeVisible()
    await expect(profile.getByTestId('team-member-selector')).toHaveCount(0)
  }else{
    await expect(page.getByTestId('team-profile-settings')).toBeDisabled()
  }
  await page.getByTestId('team-profile-back').click()
  await expect(profile).toHaveCount(0)
  await expect(page.getByTestId(/^team-row-/)).toBeVisible()
  await expect(page.getByTestId('team-membership-panel')).toBeVisible()
})
