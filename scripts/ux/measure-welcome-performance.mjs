import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'

const origins=[process.env.PB3_PERF_BASELINE??'http://127.0.0.1:16174',process.env.PB3_PERF_CURRENT??'http://127.0.0.1:16175']
for(const origin of origins)if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Local QA origin required')
const out=process.env.PB3_PERF_EVIDENCE??'docs/audits/evidence/PB3-UX-PARITY-20261116/welcome-performance.json'
const browser=await chromium.launch({headless:true})
const samples=[]
try{
  for(let trial=0;trial<5;trial++)for(let candidate=0;candidate<2;candidate++){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
    try{
      const page=await context.newPage(),start=performance.now()
      await page.goto(origins[candidate]+'/welcome')
      await page.getByTestId('welcome-screen').waitFor()
      await page.evaluate(()=>document.fonts.ready)
      const visibleMs=performance.now()-start
      const timings=await page.evaluate(()=>{
        const nav=performance.getEntriesByType('navigation')[0]
        const resources=performance.getEntriesByType('resource')
        return {domContentLoadedMs:nav.domContentLoadedEventEnd,loadMs:nav.loadEventEnd,transferredResourceBytes:resources.reduce((sum,r)=>sum+r.transferSize,0),decodedResourceBytes:resources.reduce((sum,r)=>sum+r.decodedBodySize,0)}
      })
      samples.push({trial,candidate:candidate?'current':'baseline',welcomeVisibleMs:visibleMs,...timings})
    }finally{await context.close()}
  }
}finally{await browser.close()}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
const medians=Object.fromEntries(['baseline','current'].map(candidate=>[candidate,Object.fromEntries(['welcomeVisibleMs','domContentLoadedMs','loadMs','transferredResourceBytes','decodedResourceBytes'].map(key=>[key,median(samples.filter(s=>s.candidate===candidate).map(s=>s[key]))]))]))
const result={status:'MEASURED',method:'Five interleaved fresh Chromium contexts per compiled image, 390x844; local Docker. Concurrent test workload; laboratory data, not RUM or Lighthouse.',threshold:'No invented acceptance threshold',samples,medians}
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({status:result.status,medians}))
