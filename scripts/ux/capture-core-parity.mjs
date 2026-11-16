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
const result={schema:1,browser:browser.version(),deviceScaleFactor:1,reducedMotion:'reduce',scope:'Seven approved core screens; Chromium laboratory; real encrypted durable storage',reference:'docs/ux (unchanged files)',fixtureNormalization:'Reference sample metadata and media aspect ratio only; no reference stylesheet changed',viewports:[],failures:[]}
let phase='initialization'
const frame=`.preview-bar,.preview-note{display:none!important}.preview-stage{padding:0!important;margin:0!important;display:block!important}body>.stage{padding:0!important;display:block!important}.device{width:100vw!important;height:100dvh!important;position:relative!important;top:0!important;transform:none!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.device .app{height:100%!important;border-radius:0!important}html,body{padding:0!important;margin:0!important}`
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
        await reference.goto('about:blank')
        await reference.goto(refs+url)
        if(size.width>=700)await reference.locator('[data-device="desktop"]').first().click()
      }
      async function pair(name,url,selectors,actual=page,prepare){
        phase='reference comparison: '+name
        await openReference(url)
        if(prepare)await prepare(reference,actual)
        await reference.addStyleTag({content:frame})
        await reference.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.site')?.scrollTo(0,0)})
        await page.mouse.move(0,0);await reference.mouse.move(0,0)
        await reference.screenshot({path:path.join(dir,name+'-reference.png'),mask:name.startsWith('welcome-auth')?[reference.locator('textarea')]:[]})
        await actual.screenshot({path:path.join(dir,name+'-app.png'),mask:name.startsWith('public-card')?[actual.locator('.share-url')]:name.startsWith('welcome-auth')?[actual.locator('textarea')]:[]})
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
      for(let slide=1;slide<6;slide++){
        await page.getByRole('button',{name:'Показать слайд '+(slide+1),exact:true}).click()
        await pair('welcome-slide-'+slide,'welcome/',{logo:'.welcome-logo',name:'.welcome-brand-name',actions:'.welcome-links',carousel:'.carousel',art:'.carousel-art',title:'.carousel-copy h2',dots:'.carousel-dots'},page,ref=>ref.locator('[data-slide="'+slide+'"]').click())
      }
      await page.getByRole('button',{name:'Показать слайд 1',exact:true}).click()
      await page.goto(base+'/welcome/recover')
      await pair('welcome-auth-recover','welcome/#recover',{heading:'.auth-header',back:'.auth-back',panel:'.auth-panel',key:'.auth-panel textarea',action:'.auth-panel .action.primary'})
      await page.goto(base+'/welcome/create')
      await expect(page.getByRole('button',{name:'Создать Recovery Key',exact:true})).toBeEnabled()
      await pair('welcome-auth-create','welcome/#auth',{heading:'.auth-header',back:'.auth-back',panel:'.auth-panel',action:'.auth-panel .action.primary'})
      await page.getByRole('button',{name:'Создать Recovery Key',exact:true}).click()
      await expect(page.getByTestId('welcome-generated-key')).toBeVisible()
      const recovery=await page.getByTestId('welcome-generated-key').inputValue()
      await pair('welcome-auth-generated','welcome/#auth',{heading:'.auth-header',back:'.auth-back',panel:'.auth-panel',key:'.auth-panel textarea',actions:'.actions-inline',ack:'.auth-check',action:'.auth-panel .action.primary'},page,ref=>ref.locator('[data-action="generate"]').click())
      await page.getByRole('checkbox').check()
      await page.getByTestId('welcome-finish').click()
      await expect(page.locator('[data-testid="shell-status-link"][data-session-state="online"]')).toBeVisible({timeout:90000})
      await page.getByRole('link',{name:'Камера',exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
      await pair('camera','camera/',{header:'.header,.app-header,.shell-header',dock:'.dock,.app-dock,.shell-dock',finder:'.finder,.camera-viewfinder',tabs:'.mode-tabs,.camera-mode-tabs',stage:'.stage,.camera-stage',controls:'.bottom-controls,.camera-stage-controls',shutter:'.shutter,.camera-shutter'})
      await page.getByTestId('camera-open-settings').click()
      await pair('camera-settings','camera/',{sheet:'.sheet,.camera-config-card.is-camera-sheet',handle:'.sheet-handle,.camera-sheet-handle',heading:'.sheet-heading,.camera-sheet-heading',presets:'.sheet-pill-row',name:'#setting-name,#camera-preset-name',save:'[data-action="save-preset"],[data-testid="camera-preset-save"]'},page,async(ref,actual)=>{
        await ref.locator('[data-open="settings"]').click()
        const fixture=await actual.evaluate(()=>({names:[...document.querySelectorAll('.preset-pill')].map(x=>x.textContent),name:document.querySelector('#camera-preset-name').value,note:document.querySelector('[data-testid="camera-presets"] .muted:last-child').textContent}))
        await ref.evaluate(f=>{document.querySelectorAll('.preset-pill').forEach((x,i)=>{if(f.names[i])x.textContent=f.names[i]});document.querySelector('#setting-name').value=f.name;document.querySelector('#preset-notice').textContent=f.note},fixture)
      })
      await page.getByTestId('camera-sheet-close').click()
      await page.getByRole('button',{name:'Сделать снимок'}).click()
      await expect(page.getByText(/Зашифровано и сохранено локально/)).toBeVisible()
      await page.getByRole('link',{name:'Browser',exact:true}).click()
      await expect(page.getByTestId('browser-file-thumb')).toBeVisible()
      await page.getByTestId('browser-header-settings').click()
      await page.getByRole('button',{name:'Синхронизировать',exact:true}).click()
      await page.getByTestId('browser-settings-close').click()
      await expect(page.locator('.photo-row')).toHaveAttribute('data-sync-state','synced',{timeout:30000})
      await page.getByTestId('browser-tab-personal').click()
      await page.getByTestId('browser-header-upload').click()
      await pair('browser-upload','browser/',{sheet:'.dialog-sheet,.browser-upload-sheet.open',heading:'.dialog-heading,.browser-upload-heading',destination:'#upload-destination,#media-import-destination',dropzone:'.upload-dropzone',divider:'.upload-divider',url:'#upload-url,#media-import-https-url',action:'.primary-action',note:'.upload-note'},page,async(ref,actual)=>{
        await ref.locator('[data-action="upload"]').click()
        const notes=await actual.locator('.upload-note span').allTextContents()
        await ref.locator('.upload-note span').evaluateAll((nodes,texts)=>nodes.forEach((node,i)=>node.textContent=texts[i]??''),notes)
      })
      await page.getByTestId('browser-import-sheet-close').click()
      for(const title of ['Городские прогулки','Студия']){
        await page.getByTestId('browser-header-folder').click()
        if(title==='Городские прогулки')await pair('browser-new-folder','browser/',{sheet:'.dialog-sheet,.browser-new-folder-sheet',heading:'.dialog-heading,.browser-new-folder-heading',name:'#folder-name,[data-testid="browser-folder-name"]',parent:'#folder-parent,[data-testid="browser-new-folder-parent"]',action:'.primary-action'},page,ref=>ref.locator('[data-action="create"]').click())
        await page.getByTestId('browser-folder-name').fill(title)
        await page.getByRole('button',{name:'Создать папку',exact:true}).click()
        await expect(page.getByTestId('browser-new-folder-sheet')).toHaveCount(0)
      }
      await expect(page.locator('.browser-folder-item')).toHaveCount(2)
      const catalogAnchors={header:'.app-header,.shell-header',dock:'.app-dock,.shell-dock',heading:'.browser-heading',switch:'.view-switch',tabs:'.browser-sections',path:'.browser-path',firstEntry:'.browser-entry',preview:'.entry-preview',more:'.entry-more',secondEntry:'.browser-entry:nth-child(2)'}
      async function browserData(ref,actual,mode){
        await ref.locator('[data-view="'+mode+'"]').click()
        // Equal, real text data prevents sample-only wrapping differences.
        await ref.locator('.browser-entry').evaluateAll(nodes=>nodes.slice(3).forEach(node=>node.remove()))
        const rows=await actual.locator('.browser-entry').evaluateAll(nodes=>nodes.slice(0,3).map(node=>({title:node.querySelector('.entry-copy strong').textContent,detail:node.querySelector('.entry-copy small').textContent})))
        await ref.locator('.browser-entry').evaluateAll((nodes,rows)=>rows.forEach((row,i)=>{
          nodes[i].querySelector('.entry-copy strong').textContent=row.title
          nodes[i].querySelector('.entry-copy small').textContent=row.detail
          nodes[i].querySelectorAll('.entry-copy small').forEach((node,index)=>{if(index>0)node.remove()})
        }),rows)
      }
      // Teleport anchors are display:contents, so measure explicit second folder.
      catalogAnchors.secondEntry='.browser-entry:has(.entry-folder-badge):nth-of-type(2)'
      for(const mode of ['list','grid','tree']){
        await page.getByTestId('browser-view-'+mode).click()
        await pair(mode==='list'?'browser':'browser-'+mode,'browser/',catalogAnchors,page,(ref,actual)=>browserData(ref,actual,mode))
      }
      await page.getByTestId('browser-view-list').click()
      await page.locator('.browser-entry:not(:has(.entry-folder-badge)) .entry-open').first().click()
      await expect(page.getByTestId('file-viewer-image')).toBeVisible()
      await expect(page.getByText('Обновляется список доступных файлов…',{exact:true})).toBeHidden()
      await pair('viewer','browser/viewer/',{header:'.app-header,.shell-header',dock:'.app-dock,.shell-dock',photo:'.photo-trigger',path:'.browser-path',stage:'.image-stage',summary:'.photo-summary',actions:'.action-tiles',pager:'.pager'})
      await page.getByRole('button',{name:'Скачать',exact:true}).click()
      await pair('viewer-download','browser/viewer/',{popover:'.download-pop',heading:'.download-pop strong',warning:'.download-pop p',actions:'.download-buttons'},page,async(ref,actual)=>{
        await ref.locator('[data-action="download"]').click()
        await ref.locator('.download-pop p').evaluate((node,text)=>node.textContent=text,await actual.locator('.download-pop p').textContent())
      })
      await page.getByTestId('viewer-download-cancel').click()
      await page.getByTestId('viewer-action-info').click()
      await expect(page.getByTestId('file-viewer-info')).toBeVisible()
      await pair('viewer-info','browser/viewer/',{layer:'.viewer-sheet-layer,.file-viewer-overlay',sheet:'.viewer-sheet,.approved-viewer-sheet',handle:'.sheet-handle',heading:'.sheet-heading,.file-viewer-sheet-heading',description:'.description-card',rows:'.sheet-content dl,.file-viewer-information dl'},page,async(ref,actual)=>{
        await ref.locator('[data-action="info"]').click()
        const fixture=await actual.getByTestId('file-viewer-info').evaluate(node=>({description:node.querySelector('.description-card p').textContent,rows:[...node.querySelectorAll('dl>div')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent])}))
        await ref.evaluate(f=>{document.querySelector('.description-card p').textContent=f.description;document.querySelector('.sheet-content dl').replaceChildren(...f.rows.map(([label,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);return row}))},fixture)
      })
      await page.getByTestId('viewer-panel-close').click()
      await page.locator('.photo-trigger').click()
      await expect(page.getByTestId('photo-fullscreen')).toBeVisible()
      await pair('viewer-fullscreen','browser/viewer/',{layer:'.fullscreen-layer',close:'.fullscreen-close',media:'.fullscreen-media',pager:'.fullscreen-pager'},page,ref=>ref.locator('.photo-trigger').click())
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('photo-fullscreen')).toHaveCount(0)
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
      await external.getByRole('button',{name:'Увеличить изображение'}).click()
      await expect(external.getByTestId('public-card-lightbox')).toBeVisible()
      await pair('public-card-lightbox','public-card/',{layer:'.lightbox',close:'.lightbox-close'},external,async ref=>{
        await ref.locator('#fixture').selectOption('restricted')
        await ref.locator('[data-action="zoom"]').click()
      })
      await external.keyboard.press('Escape')
      await expect(external.getByTestId('public-card-lightbox')).toHaveCount(0)
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
