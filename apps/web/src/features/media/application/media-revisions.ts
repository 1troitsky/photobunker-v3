import Dexie,{type Table} from 'dexie'
import {activeSession,requireSession,reauthenticate} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {importSigner,importSpki,sign,verify} from '../../identity/infrastructure/crypto'
import {sha} from '../../local-storage/infrastructure/cipher'
import {listLocalMedia} from './media-outbox'

const enc=new TextEncoder()
const DOMAIN='pb3.media-revision.v1\n'

export type MediaRevisionContract={
  version:1;linkId:string;operationId:string;accountId:string
  rootMediaId:string;previousMediaId:string;newMediaId:string
  rootContractHash:string;previousContractHash:string;newContractHash:string
  fromRevision:number;toRevision:number
}
export type MediaRevisionEvent={
  contract:string;signature:string;contractHash:string
}
export type MediaRevisionHistory={
  rootMediaId:string;rootContractHash:string
  revision:number;headMediaId:string;events:MediaRevisionEvent[]
}
export type MediaRevisionOperation={
  id:string;accountId:string;rootMediaId:string;contract:string
  signature:string;state:'queued'|'retry'|'sent'|'conflict'
  lastError?:string;createdAt:number
}
type CachedMediaRevisionHistory={
  key:string;accountId:string;rootMediaId:string
  history:MediaRevisionHistory;verifiedAt:number
}
class MediaRevisionDb extends Dexie{
  ops!:Table<MediaRevisionOperation,string>
  histories!:Table<CachedMediaRevisionHistory,string>
  constructor(){
    super('pb3-media-revisions-v1')
    this.version(1).stores({
      ops:'&id,accountId,[accountId+state],rootMediaId',
      histories:'&key,accountId,[accountId+rootMediaId]',
    })
  }
}
const db=new MediaRevisionDb()
function same(session:ReturnType<typeof requireSession>):void{
  if(activeSession.value!==session)throw Error('identity.changed')
}
async function hash(text:string):Promise<string>{
  return sha(enc.encode(text))
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parseEvent(raw:MediaRevisionEvent):MediaRevisionContract{
  if(!raw||typeof raw!=='object'
    ||typeof raw.contract!=='string'||typeof raw.signature!=='string'
    ||typeof raw.contractHash!=='string')throw Error('media_revision.invalid_event')
  const c=JSON.parse(raw.contract) as MediaRevisionContract
  if(!c||typeof c!=='object'||Array.isArray(c)
    ||Object.keys(c).sort().join('|')!==[
      'version','linkId','operationId','accountId',
      'rootMediaId','previousMediaId','newMediaId',
      'rootContractHash','previousContractHash','newContractHash',
      'fromRevision','toRevision',
    ].sort().join('|')||JSON.stringify(c)!==raw.contract
    ||c.version!==1
    ||!UUID.test(c.linkId)||!UUID.test(c.operationId)
    ||!UUID.test(c.accountId)||!UUID.test(c.rootMediaId)
    ||!UUID.test(c.previousMediaId)||!UUID.test(c.newMediaId)
    ||!Number.isSafeInteger(c.fromRevision)||c.fromRevision<1
    ||!Number.isSafeInteger(c.toRevision)||c.toRevision!==c.fromRevision+1
    ||c.toRevision>1000
    ||![c.rootContractHash,c.previousContractHash,c.newContractHash,
      raw.contractHash].every(x=>/^[a-f0-9]{64}$/.test(x)))
    throw Error('media_revision.invalid_event')
  return c
}

/**
 * Independently re-check every owner signature on EVERY read. The local
 * account SPKI is rooted in the already unlocked PB2 Recovery Key package,
 * not a mutable server-supplied owner directory.
 */
export async function verifyMediaRevisionHistory(
  history:MediaRevisionHistory,accountId:string,accountSpki:string,
  rootContractHash?:string,
):Promise<Array<{revision:number;mediaId:string;contractHash:string}>>{
  if(!history||!UUID.test(history.rootMediaId)
    ||!Array.isArray(history.events)||history.events.length>999
    ||history.revision!==history.events.length+1
    ||!UUID.test(history.headMediaId)
    ||!/^[a-f0-9]{64}$/.test(history.rootContractHash)
    ||(rootContractHash!==undefined
      &&history.rootContractHash!==rootContractHash))
    throw Error('media_revision.invalid_history')
  const signer=await importSpki(accountSpki)
  let head=history.rootMediaId
  const seen=new Set([head])
  let previousHash=history.rootContractHash
  const versions=[{
    revision:1,mediaId:history.rootMediaId,
    contractHash:previousHash,
  }]
  for(const [i,ev]of history.events.entries()){
    const c=parseEvent(ev)
    if(c.accountId!==accountId
      ||c.rootMediaId!==history.rootMediaId
      ||c.previousMediaId!==head
      ||c.fromRevision!==i+1||c.toRevision!==i+2
      ||c.rootContractHash!==history.rootContractHash
      ||c.previousContractHash!==previousHash
      ||seen.has(c.newMediaId)
      ||await hash(ev.contract)!==ev.contractHash
      ||!await verify(signer,DOMAIN+ev.contract,ev.signature))
      throw Error('media_revision.invalid_history')
    seen.add(c.newMediaId)
    head=c.newMediaId;previousHash=c.newContractHash
    versions.push({
      revision:c.toRevision,mediaId:head,contractHash:previousHash,
    })
  }
  if(history.headMediaId!==head)
    throw Error('media_revision.invalid_history')
  return versions
}

async function localHistory(rootMediaId:string):Promise<MediaRevisionHistory|null>{
  const session=requireSession()
  const snapshot=await db.histories.get(session.accountId+'/'+rootMediaId)
  if(!snapshot)return null
  const history=snapshot.history
  if(snapshot.accountId!==session.accountId
    ||snapshot.rootMediaId!==rootMediaId)
    throw Error('media_revision.invalid_history')
  await verifyMediaRevisionHistory(history,session.accountId,
    session.pkg.accountSpki)
  same(session)
  return history
}

export async function fetchVerifiedMediaHistory(rootMediaId:string):Promise<{
  history:MediaRevisionHistory
  versions:Array<{revision:number;mediaId:string;contractHash:string}>
}>{
  if(!UUID.test(rootMediaId))throw Error('media_revision.invalid_root')
  // A restored device may have its Recovery Key unlocked while the initial
  // session proof is still pending. A user-requested online history read
  // should re-check server authorization rather than misclassifying the
  // device as warm-offline with no cached history.
  if(!activeSession.value?.online&&navigator.onLine){
    try{await reauthenticate()}
    catch{/* Fall back to independently verified warm-offline history only. */}
  }
  const session=requireSession()
  const localRoot=(await listLocalMedia()).find(x=>x.mediaId===rootMediaId)
  const rootHash=localRoot?await hash(JSON.stringify(localRoot.contract)):undefined
  let history:MediaRevisionHistory
  if(session.online&&navigator.onLine){
    history=await jsonApi<MediaRevisionHistory>(
      '/media/v1/'+encodeURIComponent(rootMediaId)+'/revisions')
  }else{
    history=await localHistory(rootMediaId)
      ??(()=>{throw Error('media_revision.history_not_cached')})()
  }
  same(session)
  if(history.rootMediaId!==rootMediaId)
    throw Error('media_revision.invalid_history')
  const versions=await verifyMediaRevisionHistory(
    history,session.accountId,session.pkg.accountSpki,rootHash)
  // Keep only owner-signed opaque public references. Never filenames, media,
  // unwrapped DEKs, private metadata, preview or decrypted GPS.
  same(session)
  await db.histories.put({
    key:session.accountId+'/'+rootMediaId,
    accountId:session.accountId,rootMediaId,history,
    verifiedAt:Date.now(),
  })
  same(session)
  return {history,versions}
}

export async function queueMediaRevision(
  rootMediaId:string,newMediaId:string,
):Promise<string>{
  const session=requireSession()
  const {history,versions}=await fetchVerifiedMediaHistory(rootMediaId)
  const rows=await listLocalMedia()
  const root=rows.find(x=>x.mediaId===rootMediaId)
  const head=rows.find(x=>x.mediaId===history.headMediaId)
  const next=rows.find(x=>x.mediaId===newMediaId)
  if(!root||!head||!next
    ||[root,head,next].some(x=>x.state!=='synced'||x.expiresAt<=Date.now())
    ||root.mediaType!==head.mediaType||head.mediaType!==next.mediaType
    ||newMediaId===rootMediaId||newMediaId===history.headMediaId
    ||versions.some(x=>x.mediaId===newMediaId))
    throw Error('media_revision.unsuitable_media')
  const [rootHash,headHash,nextHash]=await Promise.all([
    hash(JSON.stringify(root.contract)),
    hash(JSON.stringify(head.contract)),
    hash(JSON.stringify(next.contract)),
  ])
  if(rootHash!==history.rootContractHash
    ||headHash!==versions[versions.length-1]?.contractHash)
    throw Error('media_revision.invalid_history')
  const operationId=crypto.randomUUID()
  const contract:MediaRevisionContract={
    version:1,linkId:crypto.randomUUID(),operationId,
    accountId:session.accountId,rootMediaId,
    previousMediaId:head.mediaId,newMediaId,
    rootContractHash:rootHash,previousContractHash:headHash,
    newContractHash:nextHash,
    fromRevision:history.revision,toRevision:history.revision+1,
  }
  if(contract.toRevision>1000)throw Error('media_revision.max_versions')
  const json=JSON.stringify(contract)
  const signature=await sign(await importSigner(session.pkg.accountPkcs8),
    DOMAIN+json)
  same(session)
  await db.ops.put({
    id:operationId,accountId:session.accountId,rootMediaId,
    contract:json,signature,state:'queued',createdAt:Date.now(),
  })
  void flushMediaRevisionOutbox()
  return operationId
}
export async function listMediaRevisionOperations():Promise<MediaRevisionOperation[]>{
  const session=requireSession()
  return db.ops.where('accountId').equals(session.accountId).sortBy('createdAt')
}
let running:Promise<void>|null=null
let rerun=false
export function flushMediaRevisionOutbox():Promise<void>{
  if(running){rerun=true;return running}
  running=(async()=>{
    do{
      rerun=false
      await flushPass()
    }while(rerun&&activeSession.value?.online&&navigator.onLine)
  })().finally(()=>{running=null})
  return running
}
async function flushPass():Promise<void>{
  const session=activeSession.value
  if(!session?.online||!navigator.onLine)return
  const ops=await db.ops.where('accountId').equals(session.accountId)
    .sortBy('createdAt')
  for(const op of ops.filter(x=>x.state==='queued'||x.state==='retry')){
    if(activeSession.value!==session)return
    try{
      await jsonApi('/media/v1/revisions','POST',{
        contract:op.contract,signature:op.signature,
      })
      same(session)
      await db.ops.update(op.id,{state:'sent',lastError:undefined})
    }catch(e){
      const reason=e instanceof Error?e.message:'media_revision.network_error'
      await db.ops.update(op.id,{
        state:/^api\.http_(401|403|409|410|422)$/.test(reason)
          ?'conflict':'retry',
        lastError:/^api\.http_\d+$/.test(reason)
          ?reason:'media_revision.retry_required',
      })
      if(!navigator.onLine)return
    }
  }
}
export function attachMediaRevisionLifecycle():()=>void{
  const run=()=>{void flushMediaRevisionOutbox()}
  window.addEventListener('online',run)
  document.addEventListener('visibilitychange',run)
  return()=>{
    window.removeEventListener('online',run)
    document.removeEventListener('visibilitychange',run)
  }
}
