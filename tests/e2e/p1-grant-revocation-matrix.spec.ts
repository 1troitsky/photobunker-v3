import { expect, test, type Page } from '@playwright/test'

/**
 * Real browser + Laravel + disposable PostgreSQL/Garage E2EE access matrix.
 * No mock identity, mock ACL, fake grant receipts or plaintext backend.
 */
async function enroll(page: Page): Promise<{accountId:string; recoveryKey:string}> {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Создать ключ' }).click()
  const recoveryKey = await page.locator('#generated-key').inputValue()
  expect(recoveryKey).toMatch(/^PB2\./)
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', { name: 'Завершить регистрацию' }).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.evaluate(async () => {
    const identity = await import('/src/features/identity/application/session.ts')
    await identity.reauthenticate()
  })
  const accountId = await page.evaluate(async () => {
    const identity = await import('/src/features/identity/application/session.ts')
    return identity.requireSession().accountId
  })
  return { accountId, recoveryKey }
}

test('P1 ACL matrix: A→B verified grant only, C denied, source namespace denied, revoke blocks B and recovered B2', async ({ browser }) => {
  test.setTimeout(210_000)
  const aContext = await browser.newContext()
  const bContext = await browser.newContext()
  const cContext = await browser.newContext()
  const b2Context = await browser.newContext()
  const A = await aContext.newPage()
  const B = await bContext.newPage()
  const C = await cContext.newPage()
  const B2 = await b2Context.newPage()
  try {
    const a = await enroll(A)
    await A.goto('/browser')
    const aPanel = A.locator('.media-import-p1')
    await expect(aPanel.getByTestId('media-import-file')).toBeEnabled()

    // Genuine local AES-GCM encryption, signed reserve, Garage chunks/finalize.
    const synthetic = Buffer.alloc(16391, 0x4d)
    await aPanel.getByTestId('media-import-file').setInputFiles({
      name: 'PRIVATE-ACL-MATRIX-OWNER.wav',
      mimeType: 'audio/wav',
      buffer: synthetic,
    })
    await aPanel.getByRole('button', { name: 'Отправить медиа' }).click()
    await expect.poll(() => A.evaluate(async () => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      return (await media.listLocalMedia())[0]?.state ?? 'missing'
    }), { timeout: 30_000 }).toBe('synced')
    const mediaId = await A.evaluate(async () => {
      const media = await import('/src/features/media/application/media-outbox.ts')
      const row = (await media.listLocalMedia())[0]
      if (!row) throw Error('acl.owner_media_missing')
      return row.mediaId
    })

    const b = await enroll(B)
    await B.goto('/browser')
    // Browser hydration may temporarily display the local key while its
    // authenticated server cookie has not yet been refreshed. Never
    // treat that local-only state as proof for a signed key publication.
    await B.evaluate(async () => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      const keys = await import('/src/features/sharing/key-directory.ts')
      await keys.ensureOwnExchangeKey()
    })
    const c = await enroll(C)
    expect(new Set([a.accountId,b.accountId,c.accountId]).size).toBe(3)

    const share = A.getByTestId('media-share-panel')
    await expect(share).toBeVisible()
    await share.locator('#media-share-peer-id').fill(b.accountId)
    await share.getByRole('button', { name: 'Проверить получателя медиа' }).click()
    await expect(share.getByTestId('media-recipient-fingerprint')).not.toBeEmpty()
    // Trust is not inferred from server lookup or contacts.
    await expect(share.getByText('Ключ получателя подтверждён')).toHaveCount(0)
    await share.getByLabel('Я сверил отпечаток получателя медиа').check()
    await share.getByRole('button', { name: 'Подтвердить получателя медиа' }).click()
    await expect(share.getByText('Ключ получателя подтверждён')).toBeVisible()
    await share.getByRole('button', { name: 'Передать медиа' }).click()
    await expect(share.getByText(/Разрешение сохранено/)).toBeVisible()

    const grantId = await A.evaluate(async () => {
      const grants = await import('/src/features/media/application/media-grants.ts')
      const [row] = await grants.listOutgoingMediaGrants()
      if (!row || row.state !== 'sent') throw Error('acl.grant_not_confirmed')
      return row.id
    })

    // A never becomes the recipient of its own signed transfer.
    const deniedOwner = await A.evaluate(async id => {
      const r = await fetch('/media-shares/v1/grants/'+id, {credentials:'same-origin'})
      return r.status
    }, grantId)
    expect(deniedOwner).toBe(404)

    // C knows a valid grantId AND mediaId but never receives any envelope,
    // ciphertext, receipt or owner cloud index entry.
    const cAccess = await C.evaluate(async ({grantId,mediaId}) => {
      const [grant,received,ownerManifest] = await Promise.all([
        fetch('/media-shares/v1/grants/'+grantId,{credentials:'same-origin'}),
        fetch('/media-shares/v1/received',{credentials:'same-origin'}),
        fetch('/media/v1/'+mediaId+'/manifests',{credentials:'same-origin'}),
      ])
      const own = await received.json()
      return {
        grant: grant.status,
        visible: own.items.length,
        ownerManifest: ownerManifest.status,
      }
    }, {grantId,mediaId})
    expect(cAccess).toEqual({grant:404,visible:0,ownerManifest:404})

    const received = B.getByTestId('media-share-panel')
    await received.getByRole('button', { name: 'Обновить медиа-разрешения' }).click()
    await expect(received.getByText(mediaId.slice(0, 8))).toBeVisible()

    // An assigned recipient is NOT yet an independently verified owner.
    // It must not decrypt on mere acceptance of the server response.
    const beforeTrust = await B.evaluate(async id => {
      const grants = await import('/src/features/media/application/media-grants.ts')
      try {
        await grants.readReceivedMediaGrant(id)
        return 'unexpected_decrypt'
      } catch (error) {
        return error instanceof Error ? error.message : 'unknown_error'
      }
    }, grantId)
    expect(beforeTrust).not.toBe('unexpected_decrypt')

    await received.getByRole('button', { name: 'Проверить отправителя медиа' }).click()
    await expect(received.getByTestId('media-owner-fingerprint')).not.toBeEmpty()
    await received.getByLabel('Я сверил отпечаток отправителя медиа').check()
    await received.getByRole('button', { name: 'Подтвердить отправителя медиа' }).click()
    await received.getByRole('button', { name: 'Открыть полученное медиа' }).click()
    await expect(B.getByTestId('media-decrypted-preview'))
      .toContainText('PRIVATE-ACL-MATRIX-OWNER.wav')

    const recipientProof = await B.evaluate(async ({grantId,mediaId}) => {
      const grants = await import('/src/features/media/application/media-grants.ts')
      const value = await grants.readReceivedMediaGrant(grantId)
      const bytes = new Uint8Array(await value.blob.arrayBuffer())
      const [signedGrant,ownManifest] = await Promise.all([
        fetch('/media-shares/v1/grants/'+grantId,{credentials:'same-origin'}),
        fetch('/media/v1/'+mediaId+'/manifests',{credentials:'same-origin'}),
      ])
      const grantJson = await signedGrant.json()
      return {
        name: value.metadata.fileName,
        size: bytes.length,
        first: bytes[0],
        last: bytes[bytes.length - 1],
        grantStatus: signedGrant.status,
        ownerNamespaceStatus: ownManifest.status,
        leakedName: JSON.stringify(grantJson).includes('PRIVATE-ACL-MATRIX'),
        leakedKey: JSON.stringify(grantJson).includes('akek'),
      }
    }, {grantId,mediaId})
    expect(recipientProof).toEqual({
      name:'PRIVATE-ACL-MATRIX-OWNER.wav',
      size:16391,first:0x4d,last:0x4d,
      grantStatus:200,ownerNamespaceStatus:404,
      leakedName:false,leakedKey:false,
    })

    // Revoke by the true signing owner; await the actual server ACK.
    await share.getByRole('button', { name:'Отозвать медиа' }).click()
    await expect(share.getByText('Серверный доступ отозван'))
      .toBeVisible({timeout:20_000})

    // Existing recipient session and previously trusted peer can no longer
    // fetch ANY chunk or a signed envelope via the revoked grant ID.
    const afterRevoke = await B.evaluate(async id => {
      const api = await import('/src/features/media/application/media-grants.ts')
      const list = await fetch('/media-shares/v1/received',{credentials:'same-origin'})
      const detail = await fetch('/media-shares/v1/grants/'+id,{credentials:'same-origin'})
      let clientReadError = ''
      try {
        await api.readReceivedMediaGrant(id)
      } catch (error) {
        clientReadError = error instanceof Error ? error.message : ''
      }
      return {
        receivedCount: (await list.json()).items.length,
        detailStatus: detail.status,
        clientReadError,
      }
    }, grantId)
    expect(afterRevoke).toEqual({
      receivedCount:0,detailStatus:410,clientReadError:'api.http_410',
    })

    // A *new browser/device* restored with B's real Recovery Key still
    // cannot bypass server-side revocation using a new session cookie.
    await B2.goto('/settings')
    await B2.locator('#recovery-key').fill(b.recoveryKey)
    await B2.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B2.getByText('Подтверждённая сессия')).toBeVisible()
    const restored = await B2.evaluate(async ({grantId,mediaId}) => {
      const identity = await import('/src/features/identity/application/session.ts')
      await identity.reauthenticate()
      const accountId = identity.requireSession().accountId
      const grant = await fetch('/media-shares/v1/grants/'+grantId,{
        credentials:'same-origin',cache:'no-store',
      })
      const ownerManifest = await fetch('/media/v1/'+mediaId+'/manifests',{
        credentials:'same-origin',cache:'no-store',
      })
      return {
        accountId, grantStatus: grant.status,
        ownerManifestStatus: ownerManifest.status,
      }
    }, {grantId,mediaId})
    expect(restored).toEqual({
      accountId:b.accountId,grantStatus:410,ownerManifestStatus:404,
    })

    // Revocation must NEVER delete the owner's E2EE material.
    const ownerResult = await A.evaluate(async id => {
      const m = await import('/src/features/media/application/media-outbox.ts')
      const item = await m.readCloudMedia(id)
      const bytes = new Uint8Array(await item.blob.arrayBuffer())
      return {size:bytes.length,first:bytes[0],last:bytes[bytes.length-1]}
    }, mediaId)
    expect(ownerResult).toEqual({size:16391,first:0x4d,last:0x4d})
  } finally {
    await aContext.close()
    await bContext.close()
    await cContext.close()
    await b2Context.close()
  }
})
