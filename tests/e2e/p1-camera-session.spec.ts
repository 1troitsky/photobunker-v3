import {test, expect, type Page} from '@playwright/test'

test.use({trace: 'off', screenshot: 'off', video: 'off'})

async function register(page:Page) {
  await page.goto('/settings')
  await page.getByRole('button', {name: 'Создать ключ'}).click()
  await page.getByLabel('Я сохранил ключ восстановления').check()
  await page.getByRole('button', {name: 'Завершить регистрацию'}).click()
  await expect(page.getByText('Подтверждённая сессия')).toBeVisible()
}
async function confirmed(page:Page) {
  await page.evaluate(async () => {
    const path='/src/features/identity/application/session.ts'
    const session=await import(path)
    if(!session.activeSession.value)await session.resumeExistingDevice()
    await session.reauthenticate()
  })
}
async function monitor(page:Page, hold=false) {
  await page.addInitScript(({hold}) => {
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const state={calls:0, streams:[] as MediaStream[], releases:[] as Array<()=>void>, maxLive:0}
    ;(window as any).__cameraTest=state
    navigator.mediaDevices.getUserMedia=async constraints => {
      state.calls++
      const stream=await original(constraints)
      state.streams.push(stream)
      state.maxLive=Math.max(state.maxLive,state.streams.filter(s=>s.getTracks().some(t=>t.readyState==='live')).length)
      if(hold)await new Promise<void>(resolve=>{state.releases.push(resolve)})
      return stream
    }
  }, {hold})
}
async function stats(page:Page) {
  return page.evaluate(() => {
    const state=(window as any).__cameraTest
    return {calls:state.calls,maxLive:state.maxLive,
      live:state.streams.filter((s:MediaStream)=>s.getTracks().some(t=>t.readyState==='live')).length,
      ended:state.streams.filter((s:MediaStream)=>s.getTracks().every(t=>t.readyState==='ended')).length}
  })
}
async function release(page:Page,index:number) {
  await expect.poll(()=>page.evaluate(i=>typeof (window as any).__cameraTest.releases[i],index)).toBe('function')
  await page.evaluate(i=>(window as any).__cameraTest.releases[i](),index)
}
async function playing(page:Page) {
  await expect.poll(()=>page.locator('video').evaluate(el=>(el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0)
  await expect(page.getByRole('button',{name:'Сделать снимок'})).toBeEnabled()
}

test('late permission survives real online hydration with one live stream',async({page})=>{
  await register(page)
  await monitor(page,true)
  let releaseProof!:()=>void
  const proof=new Promise<void>(resolve=>{releaseProof=resolve})
  await page.route('**/identity/v2/proof',async route=>{await proof;await route.continue()})
  await page.goto('/camera')
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__cameraTest.releases[0])).toBe('function')
  releaseProof()
  await confirmed(page)
  await release(page,0)
  await playing(page)
  expect(await stats(page)).toEqual({calls:1,maxLive:1,live:1,ended:0})
  await page.getByRole('button',{name:'Отключить',exact:true}).click()
  expect(await stats(page)).toEqual({calls:1,maxLive:1,live:0,ended:1})
})

test('equivalent Session replacement keeps the existing stream',async({page})=>{
  await register(page)
  await monitor(page)
  await page.goto('/camera');await confirmed(page);await playing(page)
  const before=await stats(page)
  await page.evaluate(()=>{
    return (async()=>{
      const path='/src/features/identity/application/session.ts'
      const m=await import(path),s=m.requireSession()
      m.activeSession.value={...s,online:!s.online,device:{...s.device},pkg:{...s.pkg}}
    })()
  })
  await playing(page)
  expect(await stats(page)).toEqual(before)
})

test('real account switch during permission stops the stale result before opening another',async({page})=>{
  await register(page)
  await monitor(page,true)
  await page.goto('/camera');await confirmed(page)
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__cameraTest.releases[0])).toBe('function')
  const changed=await page.evaluate(async()=>{
    const path='/src/features/identity/application/session.ts'
    const m=await import(path),old=m.requireSession().accountId
    await m.logout()
    const key=await m.beginRegistration()
    await m.finishRegistration(key)
    return old!==m.requireSession().accountId
  })
  expect(changed).toBe(true)
  await release(page,0)
  await expect.poll(async()=>(await stats(page)).calls).toBe(2)
  expect((await stats(page)).ended).toBe(1)
  await release(page,1);await playing(page)
  expect(await stats(page)).toEqual({calls:2,maxLive:1,live:1,ended:1})
})

test('leaving before permission resolves releases every late track without reopening',async({page})=>{
  await register(page)
  await monitor(page,true)
  await page.goto('/camera');await confirmed(page)
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__cameraTest.releases[0])).toBe('function')
  await page.getByRole('navigation',{name:'Главная навигация'}).getByRole('link',{name:'Контакты',exact:true}).click()
  await release(page,0)
  await expect.poll(async()=>(await stats(page)).ended).toBe(1)
  expect(await stats(page)).toEqual({calls:1,maxLive:1,live:0,ended:1})
  await expect(page.locator('video')).toHaveCount(0)
})

test('denied permission is recoverable by a single explicit retry',async({page})=>{
  await register(page)
  await page.addInitScript(()=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let denied=false
    navigator.mediaDevices.getUserMedia=constraints=>{
      if(!denied){denied=true;return Promise.reject(new DOMException('Camera denied fixture','NotAllowedError'))}
      return original(constraints)
    }
  })
  await page.goto('/camera');await confirmed(page)
  await expect(page.getByRole('alert')).toContainText('Camera denied fixture')
  await expect(page.getByRole('button',{name:'Сделать снимок'})).toBeDisabled()
  await page.getByRole('button',{name:'Включить камеру'}).click()
  await playing(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('hydrated camera captures offline against an already verified signed assignment policy',async({page,context})=>{
  await register(page)
  const assignmentId=await page.evaluate(async()=>{
    const path='/src/features/assignments/application/assignment-outbox.ts'
    const m=await import(path)
    const id=await m.queueAssignmentCreation({title:'Camera recovery offline',instructions:'Synthetic capture',photoGoal:30})
    await m.flushAssignmentOutbox()
    if(!(await m.listServerAssignments()).items.some((a:any)=>a.assignmentId===id))throw Error('assignment not confirmed')
    return id
  })
  await monitor(page,true)
  let allowProof!:()=>void
  const gate=new Promise<void>(resolve=>{allowProof=resolve})
  await page.route('**/identity/v2/proof',async route=>{await gate;await route.continue()})
  await page.goto('/camera?assignmentId='+assignmentId)
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__cameraTest.releases[0])).toBe('function')
  allowProof();await confirmed(page);await release(page,0)
  await playing(page)
  await expect(page.locator('#camera-assignment')).toHaveValue(assignmentId)
  await context.setOffline(true)
  await page.getByRole('button',{name:'Сделать снимок'}).click()
  await expect(page.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
  const stored=await page.evaluate(async()=>{
    const path='/src/features/photo-sync/application/p1-photo.ts'
    const m=await import(path),[photo]=await m.listLocalPhotos()
    const contract=JSON.parse(m.signedPhotoContract(photo))
    return {state:photo.state,version:contract.version,assignmentId:contract.capture.assignmentId,
      types:photo.assets.map((a:any)=>a.blob.type),digest:photo.assets.map((a:any)=>a.sha256)}
  })
  expect(stored.state).toBe('queued');expect(stored.version).toBe(2)
  expect(stored.assignmentId).toBe(assignmentId)
  expect(stored.types).toEqual(['application/octet-stream','application/octet-stream'])
  await context.setOffline(false)
  await page.getByRole('navigation',{name:'Главная навигация'}).getByRole('link',{name:'Browser',exact:true}).click()
  await page.getByRole('button',{name:'Синхронизировать'}).click()
  await expect(page.locator('.photo-row').first()).toContainText('synced')
  const digests=await page.evaluate(async()=>{
    const path='/src/features/photo-sync/application/p1-photo.ts'
    return (await (await import(path)).listLocalPhotos())[0].assets.map((a:any)=>a.sha256)
  })
  expect(digests).toEqual(stored.digest)
})
