import {expect,test,type Page} from '@playwright/test'

// Integration reconciliation of #63 with the later v3 Safe/ACL code. A real
// two-minute browser clock lead must not create the server's exact +24h TTL.
// Real account signatures, PG18, Garage ciphertext and recipient E2EE; no mocks.
async function enroll(page:Page){
  await page.goto('/settings')
  await page.getByRole('button',{name:'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button',{name:'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
  await page.goto('/browser')
  return page.evaluate(async()=>{
    const identity=await import('/src/features/identity/application/session.ts')
    await identity.reauthenticate()
    const keys=await import('/src/features/sharing/key-directory.ts')
    const own=await keys.ensureOwnExchangeKey()
    return {id:identity.requireSession().accountId,fingerprint:own.directory.safetyFingerprint}
  })
}

test('Integration #63: +2min client clock, real signed media grant/replay/readback/revoke',async({browser})=>{
  test.setTimeout(150000)
  const a=await browser.newContext(),b=await browser.newContext()
  const owner=await a.newPage(),recipient=await b.newPage()
  try{
    const own=await enroll(owner),peer=await enroll(recipient)
    // Explicit known-peer fingerprints come independently from the other
    // browser's genuine own-key publication, not blind directory TOFU.
    await owner.evaluate(async peer=>{
      const keys=await import('/src/features/sharing/key-directory.ts')
      await keys.confirmPeer(peer.id,peer.fingerprint)
    },peer)
    await recipient.evaluate(async own=>{
      const keys=await import('/src/features/sharing/key-directory.ts')
      await keys.confirmPeer(own.id,own.fingerprint)
    },own)
    const original=await owner.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32
      canvas.getContext('2d')!.fillRect(0,0,32,32)
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(
        value=>value?resolve(value):reject(Error('jpeg_failed')),'image/jpeg'))
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())))
        .map(x=>x.toString(16).padStart(2,'0')).join('')
      const media=await import('/src/features/media/application/media-outbox.ts')
      const id=await media.enqueueEncryptedMedia(new File([blob],'SYNTHETIC-CLOCK.jpg',{type:'image/jpeg'}))
      await media.synchronizeMedia()
      return {id,digest}
    })
    await expect.poll(()=>owner.evaluate(async id=>{
      const m=await import('/src/features/media/application/media-outbox.ts')
      return (await m.listLocalMedia()).find(x=>x.mediaId===id)?.state
    },original.id),{timeout:30000}).toBe('synced')
    const grant=await owner.evaluate(async({mediaId,peerId})=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      const clock=Date.now
      let id:string
      Date.now=()=>clock()+120000
      try{id=await grants.queueMediaRecipientGrant(mediaId,peerId)}
      finally{Date.now=clock}
      await grants.flushMediaGrants()
      const row=(await grants.listOutgoingMediaGrants()).find(r=>r.id===id)!
      return {id,state:row.state,contract:row.contract,signature:row.signature,
        withinServerCeiling:JSON.parse(row.contract).expiresAt<=Date.now()+86400000}
    },{mediaId:original.id,peerId:peer.id})
    expect(grant.state).toBe('sent')
    expect(grant.withinServerCeiling).toBe(true)
    const repeated=await owner.evaluate(async g=>{
      const {jsonApi}=await import('/src/features/identity/infrastructure/api.ts')
      return jsonApi('/media-shares/v1/grants','POST',{contract:g.contract,signature:g.signature})
    },grant)
    expect(repeated).toMatchObject({unchanged:true})
    const decoded=await recipient.evaluate(async id=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      const data=await grants.readReceivedMediaGrant(id)
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await data.blob.arrayBuffer())))
        .map(x=>x.toString(16).padStart(2,'0')).join('')
      return {digest,name:data.metadata.fileName}
    },grant.id)
    expect(decoded).toEqual({digest:original.digest,name:'SYNTHETIC-CLOCK.jpg'})
    await owner.evaluate(async id=>{
      const grants=await import('/src/features/media/application/media-grants.ts')
      await grants.revokeMediaGrant(id)
    },grant.id)
    const denied=await recipient.evaluate(async id=>{
      const response=await fetch('/media-shares/v1/grants/'+id,{headers:{Accept:'application/json'}})
      return response.status
    },grant.id)
    // The existing API deliberately returns Gone for a revoked grant.
    expect(denied).toBe(410)
  }finally{await a.close();await b.close()}
})
