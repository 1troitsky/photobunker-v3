import {execFile} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
const run=process.env.PB3_ACCEPTANCE_ARTIFACTS!
export function scope(value:unknown){writeFileSync(join(run,'api/audit-scope.json'),JSON.stringify(value),{mode:0o600})}
export function fixture(mode:string):Promise<any>{
  const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'))
  if(!/^pb3-accept-[a-f0-9]+$/.test(summary.project))throw Error('Refuse non-fixture project')
  const env={...process.env}
  for(const line of readFileSync(join(run,'compose.env'),'utf8').trim().split('\n')){
    const i=line.indexOf('=');env[line.slice(0,i)]=JSON.parse(line.slice(i+1))
  }
  const compose=new URL('../../scripts/local-acceptance/compose.yml',import.meta.url).pathname
  return new Promise((resolve,reject)=>execFile('docker',['compose','--project-name',summary.project,'--env-file',join(run,'compose.env'),'-f',compose,'exec','-T','api','php','audit-fixture.php',mode],{env,timeout:16000},(error,stdout)=>{
    if(error)return reject(Error('Bounded fixture command failed: '+mode))
    try{resolve(JSON.parse(stdout))}catch{resolve(stdout.trim())}
  }))
}
export async function overlappingWrites(){
  const hold=fixture('hold')
  const deadline=Date.now()+4000
  while(!existsSync(join(run,'api/audit-lock-ready'))){
    if(Date.now()>deadline)throw Error('Fixture lock not ready')
    await new Promise(r=>setTimeout(r,15))
  }
  const rotation=fixture('rotate'),consent=fixture('accept')
  let waiters=0
  try{
    for(let i=0;i<15;i++){
      waiters=(await fixture('waiters')).waiters
      if(waiters>=2)break
      await new Promise(r=>setTimeout(r,30))
    }
  }finally{writeFileSync(join(run,'api/audit-lock-release'),'release')}
  const [epoch,accept]=await Promise.all([rotation,consent]);await hold
  return {waiters,rotation:epoch.status,consent:accept.status}
}
