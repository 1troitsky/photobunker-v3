import { test, expect, type Page } from '@playwright/test'
import { register, snapshot, confirmedSession } from './helpers'

const assignmentModule = '/src/features/assignments/application/assignment-outbox.ts'

async function createAssignment(page: Page): Promise<string> {
  return page.evaluate(async path => {
    const m = await import(path)
    const id = await m.queueAssignmentCreation({title: 'Round 2 signed assignment', instructions: 'Synthetic QA', photoGoal: 30})
    await m.flushAssignmentOutbox()
    const listing = (await m.listServerAssignments()).items.find((item: any) => item.assignmentId === id)
    if (!listing || listing.state !== 'active') throw new Error('acceptance.assignment_not_confirmed')
    return id
  }, assignmentModule)
}

async function transition(page: Page, id: string, action: 'finish'|'resume') {
  return page.evaluate(async ({path, id, action}) => {
    const m = await import(path)
    const operationId = await m.queueAssignmentStateTransition(id, action)
    await m.flushAssignmentOutbox()
    const operation = (await m.listAssignmentOperations()).find((op: any) => op.id === operationId)
    if (operation?.state !== 'sent') throw new Error('acceptance.transition_not_confirmed_' + operation?.lastError)
    const listing = (await m.listServerAssignments()).items.find((item: any) => item.assignmentId === id)
    return {state: listing.state, revision: listing.revision}
  }, {path: assignmentModule, id, action})
}

test('PR14: authentic policy, forged state rejection, idempotent replay and observed-state rollback protection', async ({page}, info) => {
  await register(page)
  const id = await createAssignment(page)
  const original = await page.evaluate(async ({path, id}) => {
    const m = await import(path)
    const listing = (await m.listServerAssignments()).items.find((item: any) => item.assignmentId === id)
    await m.verifySignedAssignmentPolicy(listing)
    let tamperedRejected = false
    try { await m.verifySignedAssignmentPolicy({...listing, photoGoal: 31}) }
    catch { tamperedRejected = true }
    return {listing, tamperedRejected}
  }, {path: assignmentModule, id})
  expect(original.tamperedRejected).toBe(true)
  expect(await transition(page, id, 'finish')).toEqual({state: 'finished', revision: 2})
  const replays = await page.evaluate(async ({path, id}) => {
    const m = await import(path)
    const apiPath = '/src/features/identity/infrastructure/api.ts'
    const cryptoPath = '/src/features/identity/infrastructure/crypto.ts'
    const sessionPath = '/src/features/identity/application/session.ts'
    const {jsonApi} = await import(apiPath)
    const {sign, importSigner} = await import(cryptoPath)
    const {requireSession} = await import(sessionPath)
    const operation = (await m.listAssignmentOperations()).find((op: any) => op.kind === 'state' && JSON.parse(op.contract).assignmentId === id)
    const duplicate = await jsonApi(operation.path, 'POST', {contract: operation.contract, signature: operation.signature})
    const changed = {...JSON.parse(operation.contract), operationId: crypto.randomUUID()}
    const contract = JSON.stringify(changed)
    const signature = await sign(await importSigner(requireSession().pkg.accountPkcs8), 'pb3.assignment-state.v1\n' + contract)
    let stale = '', forged = ''
    try { await jsonApi(operation.path, 'POST', {contract, signature}) } catch (error) { stale = (error as Error).message }
    const badSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
    try { await jsonApi(operation.path, 'POST', {contract, signature: badSignature}) } catch (error) { forged = (error as Error).message }
    return {unchanged: duplicate.unchanged, revision: duplicate.revision, stale, forged}
  }, {path: assignmentModule, id})
  expect(replays).toEqual({unchanged: true, revision: 2, stale: 'api.http_409', forged: 'api.http_401'})
  await page.route('**/assignments/v1', route => route.request().method() === 'GET'
    ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({items: [original.listing], nextCursor: null})})
    : route.continue())
  const rollback = await page.evaluate(async path => {
    const m = await import(path)
    try { await m.listServerAssignments(); return '' } catch (error) { return (error as Error).message }
  }, assignmentModule)
  expect(rollback).toBe('assignment.state_rollback')
  await page.unroute('**/assignments/v1')
  expect(await transition(page, id, 'resume')).toEqual({state: 'active', revision: 3})
  await info.attach('state-authenticity-proof', {contentType: 'application/json', body: JSON.stringify({
    status: 'PASS', policyTamperRejected: true, forgedSignatureHttp: 401, staleRevisionHttp: 409,
    replayUnchanged: true, observedStateRollbackRejected: true, finalRevision: 3,
  })})
})

for (const minimumCaptureAgeMs of [0, 1500]) {
test(`PR14: offline capture v2 syncs after finish; finish/resume and grant revoke preserve contributor ciphertext (${minimumCaptureAgeMs ? 'aged capture' : 'immediate finish'})`, async ({browser}, info) => {
  test.setTimeout(120_000)
  const owner = await browser.newContext()
  const contributor = await browser.newContext({permissions: ['camera']})
  const A = await owner.newPage(), B = await contributor.newPage()
  try {
    const aId = await register(A), bId = await register(B)
    for (const page of [A, B]) {
      await page.goto('/browser')
      await expect(page.getByText('Ключ обмена подготовлен')).toBeVisible()
    }
    async function pin(page: Page, accountId: string) {
      await page.evaluate(async id => {
        const path = '/src/features/sharing/key-directory.ts'
        const keys = await import(path)
        const {directory} = await keys.inspectPeer(id)
        await keys.confirmPeer(id, directory.safetyFingerprint)
      }, accountId)
    }
    await pin(A, bId)
    await pin(B, aId)
    const id = await createAssignment(A)
    await A.evaluate(async ({path, id, recipient}) => {
      const m = await import(path)
      await m.queueAssignmentInvitation(id, recipient)
      await m.flushAssignmentOutbox()
    }, {path: assignmentModule, id, recipient: bId})
    await B.evaluate(async ({path, id}) => {
      const m = await import(path)
      const invite = (await m.listAssignmentInvites()).find((item: any) => item.assignmentId === id)
      if (!invite) throw new Error('acceptance.invitation_missing')
      await m.verifyAssignmentInvite(invite)
      await m.queueAssignmentAcceptance(invite)
      await m.flushAssignmentOutbox()
      await m.listServerAssignments()
    }, {path: assignmentModule, id})
    // Camera hydration has its own independent regression. This lifecycle
    // fixture supplies a synthetic JPEG through the actual client pipeline.
    await contributor.setOffline(true)
    await B.evaluate(async ({path, id}) => {
      const m = await import(path)
      const photoPath = '/src/features/photo-sync/application/p1-photo.ts'
      const photos = await import(photoPath)
      const canvas = document.createElement('canvas')
      canvas.width = 96; canvas.height = 96
      const context = canvas.getContext('2d')!
      context.fillStyle = '#246840'; context.fillRect(0, 0, 96, 96)
      const jpeg = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'))
      await photos.captureEncrypted(jpeg, await m.signedCaptureBinding(id))
    }, {path: assignmentModule, id})
    const before = await snapshot(B)
    expect(before).toHaveLength(1)
    const v2 = await B.evaluate(async () => {
      const path = '/src/features/photo-sync/application/p1-photo.ts'
      const m = await import(path)
      return JSON.parse(m.signedPhotoContract((await m.listLocalPhotos())[0]))
    })
    expect(v2.version).toBe(2)
    expect(v2.capture.assignmentId).toBe(id)
    expect(v2.capture.ownerAccountId).toBe(aId)
    expect(v2.capture.policyHash).toMatch(/^[a-f0-9]{64}$/)
    if (minimumCaptureAgeMs) {
      // Exercise a separate historical interval away from the subsecond edge,
      // using an actual server-time fence rather than forging capturedAt.
      await expect.poll(async () => A.evaluate(async () => {
        const response = await fetch('/identity/v2/time', {cache: 'no-store', headers: {Accept: 'application/json'}})
        return Date.parse((await response.json()).serverUtc)
      }), {timeout: 5000}).toBeGreaterThanOrEqual(v2.capture.capturedAt + minimumCaptureAgeMs)
    }
    expect(await transition(A, id, 'finish')).toEqual({state: 'finished', revision: 2})
    await contributor.setOffline(false)
    await B.getByRole('navigation', {name: 'Главная навигация'}).getByRole('link', {name: 'Browser', exact: true}).click()
    const sync = B.getByRole('button', {name: 'Синхронизировать'})
    await sync.click()
    await expect(sync).toBeEnabled()
    const observed = await B.evaluate(async () => {
      const path = '/src/features/photo-sync/application/p1-photo.ts'
      const photo = (await (await import(path)).listLocalPhotos())[0]
      return {state: photo.state, lastError: photo.lastError}
    })
    const retainedAfterFinish = JSON.stringify((await snapshot(B))[0].assets) === JSON.stringify(before[0].assets)
    await info.attach('late-capture-observation', {contentType: 'application/json', body: JSON.stringify({
      status: observed.state === 'synced' ? 'PASS' : 'FAIL', assignmentId: id,
      capturedAt: v2.capture.capturedAt, minimumCaptureAgeMs, captureBeforeFinishRequest: true,
      stateAfterFinish: observed.state, apiError: observed.lastError ?? null, ciphertextRetained: retainedAfterFinish,
    })})
    expect(retainedAfterFinish).toBe(true)
    await expect(B.locator('.photo-row').first()).toContainText('synced')
    expect((await snapshot(B))[0].assets).toEqual(before[0].assets)
    const grantId = await B.evaluate(async recipient => {
      const photoPath = '/src/features/photo-sync/application/p1-photo.ts'
      const sharePath = '/src/features/sharing/grant-flow.ts'
      const photos = await import(photoPath), share = await import(sharePath)
      const photo = (await photos.listLocalPhotos())[0]
      const grant = await share.queueRecipientGrant(photo.photoId, recipient)
      await share.flushRecipientGrants()
      if (!(await share.listOutgoingGrants()).some((g: any) => g.id === grant && g.state === 'sent')) throw new Error('acceptance.grant_not_sent')
      return grant
    }, aId)
    const finishedSubmit = await B.evaluate(async ({path, id, photoId, grantId}) => {
      const m = await import(path)
      const operation = await m.queueAssignmentSubmission(id, photoId, grantId)
      await m.flushAssignmentOutbox()
      const op = (await m.listAssignmentOperations()).find((item: any) => JSON.parse(item.contract).operationId === operation)
      return {state: op.state, error: op.lastError}
    }, {path: assignmentModule, id, photoId: before[0].photoId, grantId})
    expect(finishedSubmit).toEqual({state: 'conflict', error: 'api.http_409'})
    expect(await transition(A, id, 'resume')).toEqual({state: 'active', revision: 3})
    await B.evaluate(async ({path, id, photoId, grantId}) => {
      const m = await import(path)
      await m.listServerAssignments()
      await m.queueAssignmentSubmission(id, photoId, grantId)
      await m.flushAssignmentOutbox()
    }, {path: assignmentModule, id, photoId: before[0].photoId, grantId})
    const received = await A.evaluate(async ({path, id}) => {
      const m = await import(path)
      const sharePath = '/src/features/sharing/grant-flow.ts'
      const share = await import(sharePath)
      const items = await m.listAssignmentSubmissions(id)
      if (items.length !== 1) throw new Error('acceptance.submission_count_' + items.length)
      const blob = await share.readReceivedPhoto(items[0].photoGrantId)
      return {count: items.length, bytes: blob.size}
    }, {path: assignmentModule, id})
    expect(received.count).toBe(1)
    expect(received.bytes).toBeGreaterThan(128)
    await B.evaluate(async grant => {
      const path = '/src/features/sharing/grant-flow.ts'
      await (await import(path)).revokeOutgoingGrant(grant)
    }, grantId)
    const denied = await A.evaluate(async ({path, id, grantId}) => {
      const m = await import(path)
      const response = await fetch('/shares/v1/grants/' + grantId, {headers: {Accept: 'application/json'}, cache: 'no-store'})
      return {status: response.status, count: (await m.listAssignmentSubmissions(id)).length}
    }, {path: assignmentModule, id, grantId})
    expect(denied).toEqual({status: 410, count: 0})
    await B.reload()
    await confirmedSession(B)
    const final = await snapshot(B)
    expect(final).toHaveLength(1)
    expect(final[0].assets).toEqual(before[0].assets)
    const owned = await B.evaluate(async photoId => {
      const path = '/src/features/photo-sync/application/p1-photo.ts'
      return (await (await import(path)).readCloudPhoto(photoId)).size
    }, before[0].photoId)
    expect(owned).toBeGreaterThan(128)
    await info.attach('late-capture-proof', {contentType: 'application/json', body: JSON.stringify({
      status: 'PASS', photoContractVersion: 2, capturedOfflineBeforeFinish: true,
      synchronizedAfterFinish: true, finishedSubmissionHttp: 409, resumedRevision: 3,
      recipientDecrypted: true, revokedReadHttp: 410, revokedSubmissionCount: 0,
      contributorCloudReadable: true, ciphertextRetainedAcrossFinishResumeRevokeReload: true,
      input: 'synthetic-canvas-jpeg',
      minimumCaptureAgeMs,
    })})
  } finally { await owner.close(); await contributor.close() }
})
}
