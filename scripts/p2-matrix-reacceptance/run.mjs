/** Independent acceptance. Real PB3 HTTP auth, real browsers, real TLS Synapse.
 * No vi.mock, synthetic session assignment, disabled TLS verification or Send.
 * Usage: node browser.mjs PRODUCT_WORKTREE PRIVATE_RUN_DIRECTORY
 * Exit 0 means observations completed, NOT product acceptance.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import https from 'node:https';
import {setTimeout as sleep} from 'node:timers/promises';
const [product,run]=process.argv.slice(2).map(x=>resolve(x));
const require=createRequire(product+'/package.json');
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:25000});
const webRequire=createRequire(product+'/apps/web/package.json');
const sdk=await import(pathToFileURL(webRequire.resolve('matrix-js-sdk')).href);
const {logger}=await import(pathToFileURL(webRequire.resolve('matrix-js-sdk/lib/logger')).href);
logger.setLevel('silent');
const origin='https://matrix.pb3-audit.test';
const baseURL='http://127.0.0.1:5173';
const ca=readFileSync(run+'/tls.crt');
const accounts=JSON.parse(readFileSync(run+'/accounts.json'));
const results=[];
const qa=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const artifact=qa+'/docs/audits/evidence/P2-MATRIX-REACCEPTANCE-20261112-runtime.json';
function record(id,status,details){
 results.push({id,status,...details});
 writeFileSync(artifact,JSON.stringify({product:'5f13992b94b90157a38d25b3fe27543e3e8642f1',scope:'independent runtime; no full Messenger acceptance',results},null,2)+'\n');
 console.log(id+': '+status);
}
// HTTPS remains verified against this fixture's exact local CA/certificate.
// No NODE_TLS_REJECT_UNAUTHORIZED, Http::fake or replacement PB3 auth.
async function matrixFetch(input,init={}){
 const url=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url);
 assert.equal(url.origin,origin,'Refuse non-disposable Matrix origin');
 return new Promise((resolveResponse,reject)=>{
  const req=https.request({hostname:'127.0.0.1',port:443,servername:url.hostname,
   path:url.pathname+url.search,method:init.method??'GET',ca,
   headers:{...Object.fromEntries(new Headers(init.headers)),Host:url.host}},res=>{
    const chunks=[];res.on('data',x=>chunks.push(x));
    res.on('end',()=>resolveResponse(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
   });
  req.on('error',()=>reject(Error('audit.matrix_transport_unavailable')));
  req.setTimeout(15000,()=>req.destroy(Error('audit.matrix_timeout')));
  init.signal?.addEventListener('abort',()=>req.destroy(),{once:true});
  if(init.body)req.write(init.body);req.end();
 });
}
async function mx(path,token,method='GET',data){
 const r=await matrixFetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 return {status:r.status,data:await r.json()};
}
async function until(fn,label,seconds=40){
 const stop=Date.now()+seconds*1000;
 while(Date.now()<stop){if(await fn())return;await sleep(250);}
 throw Error('audit.timeout_'+label);
}
const clients=[];
const quietLogger={trace(){},debug(){},info(){},warn(){},error(){},log(){},getChild(){return quietLogger;}};
async function matrixLogin(name){
 const login=await mx('/_matrix/client/v3/login',null,'POST',{type:'m.login.password',identifier:{type:'m.id.user',user:name},password:accounts[name].password});
 assert.equal(login.status,200,'Disposable Matrix login');
 const keys=new Map();
 const client=sdk.createClient({baseUrl:origin,userId:login.data.user_id,deviceId:login.data.device_id,accessToken:login.data.access_token,fetchFn:matrixFetch,logger:quietLogger,
  cryptoCallbacks:{getSecretStorageKey:async({keys:offered})=>{for(const id of Object.keys(offered)){if(keys.has(id))return[id,new Uint8Array(keys.get(id))];}return null;},cacheSecretStorageKey:(id,_info,key)=>keys.set(id,new Uint8Array(key))}});
 clients.push(client);
 await client.initRustCrypto({useIndexedDB:false});
 await client.startClient({initialSyncLimit:10});
 await until(()=>[sdk.SyncState.Prepared,sdk.SyncState.Syncing].includes(client.getSyncState()),'matrix_sync');
 return {...login.data,client,keys};
}
const {execFileSync}=await import('node:child_process');
const publicKey=execFileSync('openssl',['x509','-in',run+'/tls.crt','-pubkey','-noout']);
const der=execFileSync('openssl',['pkey','-pubin','-outform','DER'],{input:publicKey});
const {createHash}=await import('node:crypto');
const pin=createHash('sha256').update(der).digest('base64');
const browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP matrix.pb3-audit.test 127.0.0.1','--ignore-certificate-errors-spki-list='+pin]});
const contexts=[];
let nextPb3Request=0;
async function page(){
 const ctx=await browser.newContext({baseURL});contexts.push(ctx);
 // Keep real security limits intact. Several PB3 route groups share the
 // standard throttle bucket; pace real requests rather than fake responses.
 await ctx.route('http://127.0.0.1:5173/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(/^\/(identity\/v2|matrix\/v1|shares\/v1)(?:\/|$)/.test(path)){
   const turn=Math.max(Date.now(),nextPb3Request);nextPb3Request=turn+1850;
   await sleep(Math.max(0,turn-Date.now()));
  }
  await route.continue();
 });
 return ctx.newPage();
}
async function enroll(p){
 await p.goto('/settings');
 await p.getByRole('button',{name:'Создать ключ',exact:true}).click();
 const recovery=await p.locator('#generated-key').inputValue();
 await p.getByLabel('Я сохранил ключ восстановления').check();
 await p.getByRole('button',{name:'Завершить регистрацию'}).click();
 await expect(p.getByText('Подтверждённая сессия')).toBeVisible({timeout:25000});
 const identity=await p.evaluate(async()=>{const {requireSession}=await import('/src/features/identity/application/session.ts');const s=requireSession();return {accountId:s.accountId,deviceId:s.deviceId};});
 return {...identity,recovery};
}
async function restore(p,key){
 await p.goto('/settings');await p.locator('#recovery-key').fill(key);
 await p.getByRole('button',{name:'Восстановить',exact:true}).click();
 await expect(p.getByText('Подтверждённая сессия')).toBeVisible({timeout:25000});
}
async function bind(p,m){
 await p.evaluate(async v=>{const {beginMatrixBinding}=await import('/src/features/messages/application/matrix-binding.ts');await beginMatrixBinding(v);},
  {matrixUserId:m.user_id,matrixDeviceId:m.device_id,accessToken:m.access_token});
}
try{
 const {runReacceptance}=await import('./scenarios.mjs');
 await runReacceptance({page,enroll,restore,bind,matrixLogin,mx,record,run,product,qa,expect,clients});
}catch(e){
 writeFileSync(run+'/private-error.log',String(e.stack),{mode:0o600});
 record('RUNNER','BLOCKED',{reason:'Unexpected scenario failure; private diagnostics retained',errorClass:e.name});
 process.exitCode=1;
}finally{
 for(const c of clients)c.stopClient();
 for(const c of contexts)await c.close();
 await browser.close();
}
process.exit(process.exitCode??0);
