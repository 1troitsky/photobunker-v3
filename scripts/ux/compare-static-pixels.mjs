import {chromium} from '@playwright/test'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import path from 'node:path'

const root=process.argv[2]??'docs/audits/evidence/PB3-UX-STATES-20261117'
const browser=await chromium.launch({headless:true})
const result=[]
try{
  const page=await browser.newPage()
  for(const viewport of await readdir(root)){
    if(!/^\d+x\d+$/.test(viewport))continue
    for(const screen of ['welcome','welcome-slide-1','welcome-slide-2','welcome-slide-3','welcome-slide-4','welcome-slide-5','welcome-loading','pin','camera-blind','camera-audio-stage']){
      const a=await readFile(path.join(root,viewport,screen+'-reference.png'))
      const b=await readFile(path.join(root,viewport,screen+'-app.png'))
      const comparison=await page.evaluate(async([a,b])=>{
        async function pixels(data){
          const response=await fetch('data:image/png;base64,'+data)
          const image=await createImageBitmap(await response.blob())
          const canvas=document.createElement('canvas')
          canvas.width=image.width;canvas.height=image.height
          const context=canvas.getContext('2d',{willReadFrequently:true})
          context.drawImage(image,0,0)
          return {width:image.width,height:image.height,data:context.getImageData(0,0,image.width,image.height).data}
        }
        const x=await pixels(a),y=await pixels(b)
        if(x.width!==y.width||x.height!==y.height)return {status:'FAIL',reason:'different image dimensions'}
        let different=0,left=x.width,top=x.height,right=-1,bottom=-1
        for(let i=0;i<x.data.length;i+=4){
          if(x.data[i]===y.data[i]&&x.data[i+1]===y.data[i+1]&&x.data[i+2]===y.data[i+2]&&x.data[i+3]===y.data[i+3])continue
          different++;const px=(i/4)%x.width,py=Math.floor(i/4/x.width)
          left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py)
        }
        return {status:different?'FAIL':'PASS',different_pixels:different,total_pixels:x.width*x.height,bounds:different?{left,top,right,bottom}:null}
      },[a.toString('base64'),b.toString('base64')])
      result.push({viewport,screen,...comparison})
    }
  }
}finally{await browser.close()}
await writeFile(path.join(root,'pixel-comparison.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result))
if(result.some(item=>item.status!=='PASS'))process.exitCode=1
