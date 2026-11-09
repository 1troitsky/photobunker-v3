import {test,expect} from '@playwright/test'

test('P1-12: immutable owner-signed media versions survive Garage+Recovery Key without modifying original or inheriting grants',async({browser})=>{
  test.setTimeout(145000)
  const primary=await browser.newContext()
  const restored=await browser.newContext()
  const A=await primary.newPage()
  const B=await restored.newPage()
  try{
    await A.goto('/settings')
    await A.getByRole('button',{name:'Создать ключ'}).click()
    const key=await A.locator('#generated-key').inputValue()
    await A.getByLabel('Я сохранил ключ восстановления').check()
    await A.getByRole('button',{name:'Завершить регистрацию'}).click()
    await expect(A.getByText('Подтверждённая сессия')).toBeVisible()
    await A.goto('/browser')
    const media=A.locator('.media-import-p1')
    const snapshots=[
      {name:'PRIVATE-ORIGINAL-VOICE.wav',byte:0x31},
      {name:'PRIVATE-EDITED-VOICE-V2.wav',byte:0x45},
      {name:'PRIVATE-EDITED-VOICE-V3.wav',byte:0x73},
    ]
    const ids:string[]=[]
    for(const file of snapshots){
      await media.getByTestId('media-import-file').setInputFiles({
        name:file.name,mimeType:'audio/wav',
        buffer:Buffer.alloc(1025,file.byte),
      })
      await media.getByRole('button',{name:'Отправить медиа'}).click()
      await expect.poll(()=>A.evaluate(async()=>{
        const mod=await import('/src/features/media/application/media-outbox.ts')
        return (await mod.listLocalMedia()).filter(x=>x.state==='synced').length
      }),{timeout:30000}).toBe(ids.length+1)
      const next=await A.evaluate(async()=>{
        const mod=await import('/src/features/media/application/media-outbox.ts')
        return (await mod.listLocalMedia())[0]!.mediaId
      })
      ids.push(next)
    }
    expect(new Set(ids).size).toBe(3)

    const version=A.getByTestId('media-revision-panel')
    await version.getByTestId('media-version-root').selectOption(ids[0]!)
    await version.getByRole('button',{name:'Проверить историю версий'}).click()
    await expect(version.getByTestId('media-revision-count'))
      .toContainText('1',{timeout:15000})

    for(const [index,id]of ids.slice(1).entries()){
      await version.getByTestId('media-version-next').selectOption(id)
      await version.getByRole('button',{name:'Связать как новую версию'}).click()
      await expect(version.getByTestId('media-revision-count'))
        .toContainText(String(index+2),{timeout:20000})
    }
    await expect(version.getByText('Версия 3')).toBeVisible()
    const audit=await A.evaluate(async rootMediaId=>{
      const r=await fetch('/media/v1/'+rootMediaId+'/revisions',{
        credentials:'same-origin',
      })
      return {status:r.status,data:await r.json()}
    },ids[0]!)
    expect(audit.status).toBe(200)
    expect(audit.data.revision).toBe(3)
    expect(audit.data.events).toHaveLength(2)
    expect(audit.data.headMediaId).toBe(ids[2])
    expect(JSON.stringify(audit.data)).not.toContain('PRIVATE-ORIGINAL')
    expect(JSON.stringify(audit.data)).not.toContain('audio/wav')
    const state=await A.evaluate(async()=>{
      const files=await import('/src/features/media/application/media-outbox.ts')
      const grants=await import('/src/features/media/application/media-grants.ts')
      const [list,outgoing]=await Promise.all([
        files.listLocalMedia(),grants.listOutgoingMediaGrants(),
      ])
      return {
        originals:list.filter(x=>x.state==='synced').length,
        mediaIds:list.map(x=>x.mediaId),
        grants:outgoing.length,
      }
    })
    expect(state.originals).toBe(3)
    expect(new Set(state.mediaIds)).toEqual(new Set(ids))
    expect(state.grants).toBe(0) // links must NEVER auto-share DEK

    // A new authenticated device with the same Recovery Key can independently
    // verify every owner signature and decrypt each immutable cloud version.
    await B.goto('/settings')
    await B.locator('#recovery-key').fill(key)
    await B.getByRole('button',{name:'Восстановить',exact:true}).click()
    await expect(B.getByText('Подтверждённая сессия')).toBeVisible()
    await B.goto('/browser')
    // Recovery Key proof and trusted-device IndexedDB hydration are distinct
    // async steps. Never run account-scoped local reads before unlock.
    await expect.poll(()=>B.evaluate(async()=>{
      const identity=await import('/src/features/identity/application/session.ts')
      return identity.activeSession.value?.online===true
    }),{timeout:20000}).toBe(true)
    const remotelyVerified=await B.evaluate(async idArray=>{
      const version=await import('/src/features/media/application/media-revisions.ts')
      const files=await import('/src/features/media/application/media-outbox.ts')
      const [{history,versions},local]=await Promise.all([
        version.fetchVerifiedMediaHistory(idArray[0]!),
        files.listLocalMedia(),
      ])
      const recovered=[]
      for(const id of idArray){
        const item=await files.readCloudMedia(id)
        const first=new Uint8Array(await item.blob.slice(0,1).arrayBuffer())[0]
        recovered.push({
          mediaId:id,byte:first,name:item.metadata.fileName,
          count:item.blob.size,
        })
      }
      return {
        revision:history.revision,
        chain:versions.map(x=>x.mediaId),
        localCount:local.length,recovered,
      }
    },ids)
    expect(remotelyVerified).toEqual({
      revision:3,chain:ids,localCount:0,
      recovered:ids.map((mediaId,index)=>({
        mediaId,byte:snapshots[index]!.byte,
        name:snapshots[index]!.name,count:1025,
      })),
    })
    // Independent reader never mistakes an owner-signed revision link for
    // recipient access or automatic replacement of an old file.
  }finally{
    await primary.close()
    await restored.close()
  }
})
