import {chromium,expect} from '@playwright/test'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

// Destructive resets, fake ACKs and mocked crypto are deliberately absent.
// Run only against an isolated disposable local API / PostgreSQL / Garage stack.
const root=fileURLToPath(new URL('../../',import.meta.url))
const base=process.env.PB3_UX_BASE_URL??'http://127.0.0.1:16173'
assert(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Local QA origin required')
const out=path.resolve(process.env.PB3_UX_EVIDENCE_DIR??'.local-delivery/ux-visual')
const sizes=(process.env.PB3_UX_VIEWPORTS??'390x844').split(',').map(value=>{
  const [width,height]=value.split('x').map(Number)
  assert(width>=320&&height>=320,'Invalid viewport')
  return {width,height}
})
await mkdir(out,{recursive:true})
const server=createServer(async(req,res)=>{
  try{
    let relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    if(relative.endsWith('/'))relative+='index.html'
    const file=path.resolve(root,'.'+relative)
    assert(file.startsWith(path.join(root,'docs/ux')+path.sep))
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream')
    res.end(await readFile(file))
  }catch{res.writeHead(404);res.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const refs='http://127.0.0.1:'+server.address().port+'/docs/ux/'
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']})
const result={schema:1,scope:'Seven approved core screens; Chromium laboratory; real encrypted durable storage',reference:'docs/ux (unchanged files)',fixtureNormalization:'Public reference text and image aspect ratio only; no reference stylesheet changed',viewports:[],failures:[]}
let phase='initialization'
const frame=`.preview-bar,.preview-note{display:none!important}.preview-stage{padding:0!important;margin:0!important;display:block!important}body>.stage{padding:0!important;display:block!important}.device{width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.device .app{height:100%!important;border-radius:0!important}html,body{padding:0!important;margin:0!important}`
async function measure(page,selectors){
  return page.evaluate(selectors=>Object.fromEntries(Object.entries(selectors).map(([key,selector])=>{
    const element=document.querySelector(selector)
    if(!element)return [key,null]
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element),before=getComputedStyle(element,'::before')
    return [key,{x:rect.x,y:rect.y,w:rect.width,h:rect.height,font:style.font,color:style.color,background:style.backgroundColor,padding:style.padding,radius:style.borderRadius,lineHeight:style.lineHeight,backgroundImage:style.backgroundImage,boxShadow:style.boxShadow,filter:style.filter,opacity:style.opacity,isolation:style.isolation,before:{background:before.backgroundImage,filter:before.filter,opacity:before.opacity,inset:before.inset}}]
  })),selectors)
}
try{
  for(const size of sizes){
    const context=await browser.newContext({viewport:size,permissions:['camera'],reducedMotion:'reduce'})
    try{
      const page=await context.newPage(),reference=await context.newPage()
      const metrics={viewport:size,screens:{}}
      const dir=path.join(out,`${size.width}x${size.height}`)
      await mkdir(dir,{recursive:true})
      async function openReference(url){
        await reference.goto(refs+url)
        if(size.width>=700)await reference.locator('[data-device="desktop"]').first().click()
      }
      async function pair(name,url,selectors,actual=page,prepare){
        phase='reference comparison: '+name
        await openReference(url)
        if(prepare)await prepare(reference,actual)
        await reference.addStyleTag({content:frame})
        await page.mouse.move(0,0);await reference.mouse.move(0,0)
        await reference.screenshot({path:path.join(dir,name+'-reference.png')})
        await actual.screenshot({path:path.join(dir,name+'-app.png'),mask:name==='public-card'?[actual.locator('.share-url')]:[]})
        const source=await measure(reference,selectors),app=await measure(actual,selectors)
        metrics.screens[name]={reference:source,app}
        for(const [key,expected] of Object.entries(source)){
          if(!expected||!app[key]){result.failures.push({viewport:size,screen:name,anchor:key,reason:'missing'});continue}
          for(const dimension of ['x','y','w','h']){
            const delta=app[key][dimension]-expected[dimension]
            if(delta!==0)result.failures.push({viewport:size,screen:name,anchor:key,dimension,delta})
          }
        }
      }
      await page.goto(base+'/welcome')
      await expect(page.getByTestId('welcome-screen')).toBeVisible()
      await pair('welcome','welcome/',{logo:'.welcome-logo',name:'.welcome-brand-name',actions:'.welcome-links',carousel:'.carousel',art:'.carousel-art',title:'.carousel-copy h2',dots:'.carousel-dots'})
      await page.goto(base+'/settings')
      await page.getByRole('button',{name:'Создать ключ'}).click()
      const recovery=await page.locator('#generated-key').inputValue()
      await page.getByLabel('Я сохранил ключ восстановления').check()
      await page.getByRole('button',{name:'Завершить регистрацию'}).click()
      await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible()
      await page.getByRole('link',{name:'Камера',exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
      await pair('camera','camera/',{header:'.header,.app-header,.shell-header',dock:'.dock,.app-dock,.shell-dock',finder:'.finder,.camera-viewfinder',tabs:'.mode-tabs,.camera-mode-tabs',stage:'.stage,.camera-stage',controls:'.bottom-controls,.camera-stage-controls',shutter:'.shutter,.camera-shutter'})
      await page.getByRole('button',{name:'Сделать снимок'}).click()
      await expect(page.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
      await page.getByRole('link',{name:'Browser',exact:true}).click()
      await expect(page.getByTestId('browser-file-thumb')).toBeVisible()
      await page.getByTestId('browser-header-settings').click()
      await page.getByRole('button',{name:'Синхронизировать',exact:true}).click()
      await page.getByTestId('browser-settings-close').click()
      await expect(page.locator('.photo-row')).toHaveAttribute('data-sync-state','synced',{timeout:30000})
      await page.getByTestId('browser-tab-personal').click()
      await pair('browser','browser/',{header:'.app-header,.shell-header',dock:'.app-dock,.shell-dock',heading:'.browser-heading',switch:'.view-switch',tabs:'.browser-sections',path:'.browser-path',firstEntry:'.browser-entry',preview:'.entry-preview',more:'.entry-more'})
      await page.locator('.browser-entry .entry-open').first().click()
      await expect(page.getByTestId('file-viewer-image')).toBeVisible()
      await expect(page.getByText('Обновляется список доступных файлов…',{exact:true})).toBeHidden()
      await pair('viewer','browser/viewer/',{header:'.app-header,.shell-header',dock:'.app-dock,.shell-dock',photo:'.photo-trigger',path:'.browser-path',stage:'.image-stage',summary:'.photo-summary',actions:'.action-tiles',pager:'.pager'})
      phase='real publication'
      await page.getByTestId('viewer-action-publish').click()
      await page.getByTestId('public-card-publish-review').check()
      await page.getByTestId('public-card-publish').click()
      const address=page.getByTestId('public-card-published-url')
      await expect(address).toHaveValue(/#key=[A-Za-z0-9_-]{43}/,{timeout:30000})
      const external=await context.newPage()
      await external.goto(await address.inputValue())
      await expect(external.getByTestId('public-card-image')).toBeVisible()
      await pair('public-card','public-card/',{header:'.site-head',page:'.page',title:'.card-title',media:'.media',availability:'.availability',footer:'.bottom-brand'},external,async(ref,actual)=>{
        await ref.locator('#fixture').selectOption('restricted')
        const fixture=await actual.evaluate(()=>({name:document.querySelector('.file-name').textContent,id:document.querySelector('.file-id').textContent,title:document.querySelector('.time-title').textContent,caption:document.querySelector('.time-caption').textContent,pill:document.querySelector('.time-pill').textContent,ratio:document.querySelector('.safe-media').naturalWidth/document.querySelector('.safe-media').naturalHeight}))
        // Runtime sample DATA only, so geometry compares equal text and aspect.
        await ref.evaluate(f=>{
          for(const [selector,key] of [['.file-name','name'],['.file-id','id'],['.time-title','title'],['.time-caption','caption'],['.time-pill','pill']])document.querySelector(selector).textContent=f[key]
          document.querySelector('.description').closest('.info-section').remove()
          document.querySelector('.safe-media').setAttribute('viewBox',`0 0 ${565*f.ratio} 565`)
        },fixture)
      })
      await external.close()
      await page.goto(base+'/settings/security')
      await page.getByTestId('security-pin-create').click()
      await page.getByTestId('security-pin-new').fill('4826')
      await page.getByTestId('security-pin-repeat').fill('4826')
      await page.getByTestId('security-pin-recovery').fill(recovery)
      await page.getByTestId('security-pin-ack').check()
      await page.getByTestId('security-pin-save').click()
      await expect(page.getByRole('heading',{name:'Введите PIN'})).toBeVisible({timeout:90000})
      await pair('pin','pin-shell/',{logo:'.brand-logo',name:'.brand-title',instructions:'.pin-instructions',keys:'.keypad',digit:'.digit',footer:'.pin-foot'})
      const blocker=await context.newPage()
      await blocker.goto(base+'/icons/app.svg')
      // A genuine, read-only-in-effect IDB transaction holds hydration. It writes
      // no data, has a hard 30s deadline and is released even if capture fails.
      await blocker.evaluate(()=>new Promise((resolve,reject)=>{
        const req=indexedDB.open('pb3-identity-v2')
        req.onerror=()=>reject(Error('database unavailable'))
        req.onsuccess=()=>{
          const db=req.result,tx=db.transaction('devices','readwrite'),store=tx.objectStore('devices'),deadline=performance.now()+30000
          window.releaseParityHydration=false
          function keep(){store.get('visual-lock-only').onsuccess=()=>{if(!window.releaseParityHydration&&performance.now()<deadline)keep()}}
          keep();resolve(true)
        }
      }))
      try{
        await page.reload({waitUntil:'domcontentloaded'})
        await expect(page.getByTestId('welcome-bootstrap-loading')).toBeVisible()
        await pair('welcome-loading','welcome/loader/',{logo:'.welcome-logo',name:'.welcome-brand-name',loading:'.welcome-loading',spinner:'.welcome-loading-spinner',text:'.welcome-loading-text',carousel:'.carousel'})
      }finally{await blocker.evaluate(()=>{window.releaseParityHydration=true});await blocker.close()}
      await expect(page.getByRole('heading',{name:'Введите PIN'})).toBeVisible()
      result.viewports.push(metrics)
    }finally{await context.close()}
  }
}catch(error){
  // Never serialize an exception with a capability URL or Recovery Key.
  const message=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g,'<redacted URL>').replace(/PB2\.[A-Za-z0-9._-]+/g,'<redacted key>')
  result.failures.push({phase,reason:'Real journey did not complete; no visual PASS',message})
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve))
  result.status=result.failures.length||result.viewports.length!==sizes.length?'FAIL':'PASS'
  await writeFile(path.join(out,'geometry.json'),JSON.stringify(result,null,2)+'\n')
}
console.log(JSON.stringify({status:result.status,viewports:result.viewports.length,mismatches:result.failures.length}))
assert.equal(result.failures.length,0,'Approved geometry mismatch; see geometry.json')
