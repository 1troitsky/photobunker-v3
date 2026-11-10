import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import {
  b64, unb64, random, digest, hex, uuid, importSigner, importSpki, sign, verify,
} from '../../identity/infrastructure/crypto'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const profileAAD='pb3.team-profile.v1\n'
const ownerKeyAAD='pb3.team-owner-key.v1\n'
const localAAD='pb3.team-local.v1\n'
const domain='pb3.team-create.v1\n'
type Delivery='queued'|'synced'|'conflict'
type Cipher={iv:string;ciphertext:string}
type TeamEnvelope=Cipher & {version:1;wrappedKey:Cipher}
type TeamContract={
  version:1;teamId:string;operationId:string;ownerAccountId:string
  privateEnvelope:TeamEnvelope
}
type CachedTeam={
  version:1;teamId:string;ownerAccountId:string
  contract:string;signature:string;delivery:Delivery;memberCount:number
}
type StoredTeam={key:string;ownerScope:string;iv:string;ciphertext:string}
type ServerTeam={
  teamId:string;ownerAccountId:string;state:string
  contract:string;signature:string;memberCount:number
}
type ServerPage={items:ServerTeam[];nextCursor:string|null}
export type TeamView={
  teamId:string;name:string;description:string;memberCount:number;delivery:Delivery
}

class TeamDB extends Dexie{
  teams!:Table<StoredTeam,string>
  constructor(){super('pb3-encrypted-teams-v1');this.version(1).stores({teams:'&key,ownerScope'})}
}
const db=new TeamDB()
function same(s:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.akek!==s.pkg.akek||now.pkg.accountSpki!==s.pkg.accountSpki
    ||now.pkg.revision!==s.pkg.revision)throw Error('identity.changed')
}
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function ids(accountId:string,teamId?:string){
  const ownerScope=await hash('pb3.team-scope.v1\n'+accountId)
  return {ownerScope,key:teamId
    ?await hash('pb3.team-row.v1\n'+accountId+'\n'+teamId):undefined}
}
function aad(scope:string,key:string):Uint8Array<ArrayBuffer>{
  return enc.encode(localAAD+scope+'\n'+key)
}
async function key(s:Session):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',bytes,
    {name:'AES-GCM'},false,['encrypt','decrypt'])}
  finally{bytes.fill(0)}
}
function parse(raw:string):TeamContract{
  let value:TeamContract
  try{value=JSON.parse(raw) as TeamContract}
  catch{throw Error('teams.invalid_contract')}
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join('|')
      !=='operationId|ownerAccountId|privateEnvelope|teamId|version'
    ||value.version!==1
    ||typeof value.teamId!=='string'||!uuidPattern.test(value.teamId)
    ||typeof value.operationId!=='string'||!uuidPattern.test(value.operationId)
    ||typeof value.ownerAccountId!=='string'||!uuidPattern.test(value.ownerAccountId)
    ||!value.privateEnvelope
    ||Object.keys(value.privateEnvelope).sort().join('|')
      !=='ciphertext|iv|version|wrappedKey'
    ||value.privateEnvelope.version!==1
    ||typeof value.privateEnvelope.iv!=='string'
    ||typeof value.privateEnvelope.ciphertext!=='string'
    ||!value.privateEnvelope.wrappedKey
    ||Object.keys(value.privateEnvelope.wrappedKey).sort().join('|')
      !=='ciphertext|iv'
    ||typeof value.privateEnvelope.wrappedKey.iv!=='string'
    ||typeof value.privateEnvelope.wrappedKey.ciphertext!=='string'
    ||JSON.stringify(value)!==raw)throw Error('teams.invalid_contract')
  unb64(value.privateEnvelope.iv,12)
  unb64(value.privateEnvelope.wrappedKey.iv,12)
  unb64(value.privateEnvelope.wrappedKey.ciphertext,48)
  const bytes=unb64(value.privateEnvelope.ciphertext)
  if(bytes.length<32||bytes.length>4096)throw Error('teams.invalid_contract')
  return value
}
async function verified(s:Session,entry:CachedTeam):Promise<TeamView>{
  if(entry.version!==1||entry.ownerAccountId!==s.accountId
    ||!['queued','synced','conflict'].includes(entry.delivery)
    ||!Number.isSafeInteger(entry.memberCount)||entry.memberCount<1
    ||Object.keys(entry).sort().join('|')
      !=='contract|delivery|memberCount|ownerAccountId|signature|teamId|version')
    throw Error('teams.invalid_record')
  const c=parse(entry.contract)
  if(c.teamId!==entry.teamId||c.ownerAccountId!==s.accountId
    ||!await verify(await importSpki(s.pkg.accountSpki),
      domain+entry.contract,entry.signature))
    throw Error('teams.untrusted_contract')
  let plain:ArrayBuffer
  try{
    const dekBytes=new Uint8Array(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(c.privateEnvelope.wrappedKey.iv,12),
      additionalData:enc.encode(ownerKeyAAD+s.accountId+'\n'+entry.teamId),
      tagLength:128,
    },await key(s),unb64(c.privateEnvelope.wrappedKey.ciphertext,48)))
    try{
      if(dekBytes.length!==32)throw Error('teams.invalid_team_key')
      const dek=await crypto.subtle.importKey('raw',dekBytes,
        {name:'AES-GCM'},false,['decrypt'])
      plain=await crypto.subtle.decrypt({
        name:'AES-GCM',iv:unb64(c.privateEnvelope.iv,12),
        additionalData:enc.encode(profileAAD+s.accountId+'\n'+entry.teamId),
        tagLength:128,
      },dek,unb64(c.privateEnvelope.ciphertext))
    }finally{dekBytes.fill(0)}
  }catch{throw Error('teams.encrypted_profile_unreadable')}
  let data:{name:string;description:string}
  try{data=JSON.parse(dec.decode(plain)) as {name:string;description:string}}
  catch{throw Error('teams.invalid_profile')}
  if(!data||typeof data.name!=='string'||typeof data.description!=='string'
    ||Object.keys(data).sort().join('|')!=='description|name'
    ||data.name.trim()!==data.name||data.name.length<1||data.name.length>64
    ||data.description.trim()!==data.description||data.description.length>1024)
    throw Error('teams.invalid_profile')
  same(s)
  return {teamId:entry.teamId,name:data.name,description:data.description,
    memberCount:entry.memberCount,delivery:entry.delivery}
}
async function store(s:Session,entry:CachedTeam):Promise<void>{
  same(s)
  // Refuse persisting unverified server responses, including a changed contract.
  await verified(s,entry)
  const {ownerScope,key:rowKey}=await ids(s.accountId,entry.teamId)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:aad(ownerScope,rowKey!),tagLength:128,
  },await key(s),enc.encode(JSON.stringify(entry)))
  same(s)
  await db.teams.put({key:rowKey!,ownerScope,iv:b64(iv),ciphertext:b64(ciphertext)})
  same(s)
}
async function localEntries(s:Session):Promise<CachedTeam[]>{
  const {ownerScope}=await ids(s.accountId)
  const rows=await db.teams.where('ownerScope').equals(ownerScope).toArray()
  const k=await key(s),items:CachedTeam[]=[]
  for(const row of rows){
    same(s)
    if(row.ownerScope!==ownerScope||!/^[a-f0-9]{64}$/.test(row.key))
      throw Error('teams.invalid_record')
    let bytes:ArrayBuffer
    try{bytes=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(row.iv,12),
      additionalData:aad(row.ownerScope,row.key),tagLength:128,
    },k,unb64(row.ciphertext))}
    catch{throw Error('teams.encrypted_record_unreadable')}
    let item:CachedTeam
    try{item=JSON.parse(dec.decode(bytes)) as CachedTeam}
    catch{throw Error('teams.invalid_record')}
    const expected=await ids(s.accountId,item.teamId)
    if(expected.key!==row.key)throw Error('teams.invalid_record_scope')
    await verified(s,item)
    items.push(item)
  }
  return items
}
/** Offline-capable cached list. Local queued teams are explicitly NOT server-accepted. */
export async function listLocalTeams():Promise<TeamView[]>{
  const s=requireSession(),items=await localEntries(s)
  const result:TeamView[]=[]
  for(const item of items)result.push(await verified(s,item))
  same(s)
  return result.sort((a,b)=>a.name.localeCompare(b.name))
}
/** Durably persist encrypted signed operation before any HTTP request. */
export async function queueTeam(name:string,description:string):Promise<TeamView>{
  const s=requireSession(),cleanName=name.trim(),cleanDescription=description.trim()
  if(!cleanName||cleanName.length>64||cleanDescription.length>1024
    ||/\p{Cc}/u.test(cleanName+cleanDescription))
    throw Error('teams.invalid_name')
  const teamId=uuid(),operationId=uuid()
  const iv=random(12),wrapIv=random(12),rawTeamKey=random(32)
  let envelope:TeamEnvelope
  try{
    const dek=await crypto.subtle.importKey('raw',rawTeamKey,
      {name:'AES-GCM'},false,['encrypt'])
    const [ciphertext,wrapped]=await Promise.all([
      crypto.subtle.encrypt({
        name:'AES-GCM',iv,
        additionalData:enc.encode(profileAAD+s.accountId+'\n'+teamId),
        tagLength:128,
      },dek,enc.encode(JSON.stringify({name:cleanName,description:cleanDescription}))),
      crypto.subtle.encrypt({
        name:'AES-GCM',iv:wrapIv,
        additionalData:enc.encode(ownerKeyAAD+s.accountId+'\n'+teamId),
        tagLength:128,
      },await key(s),rawTeamKey),
    ])
    envelope={version:1,iv:b64(iv),ciphertext:b64(ciphertext),
      wrappedKey:{iv:b64(wrapIv),ciphertext:b64(wrapped)}}
  }finally{rawTeamKey.fill(0)}
  const contract:TeamContract={
    version:1,teamId,operationId,ownerAccountId:s.accountId,
    privateEnvelope:envelope,
  }
  const raw=JSON.stringify(contract)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),domain+raw)
  same(s)
  const entry:CachedTeam={version:1,teamId,ownerAccountId:s.accountId,
    contract:raw,signature,delivery:'queued',memberCount:1}
  await store(s,entry)
  return verified(s,entry)
}
/** Exact ACK replay: a lost HTTP response leaves the same signed operation queued. */
export async function syncQueuedTeams():Promise<void>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))return
  const items=await localEntries(s)
  for(const item of items.filter(x=>x.delivery==='queued')){
    same(s)
    try{
      const ack=await jsonApi<{teamId:string;state:string;unchanged:boolean}>(
        '/teams/v1','POST',{contract:item.contract,signature:item.signature})
      same(s)
      if(ack.teamId!==item.teamId||ack.state!=='active'
        ||typeof ack.unchanged!=='boolean')throw Error('teams.invalid_ack')
      await store(s,{...item,delivery:'synced'})
    }catch(e){
      same(s)
      if(e instanceof Error&&e.message==='api.http_409')
        await store(s,{...item,delivery:'conflict'})
      else throw e
    }
  }
}
export async function refreshTeams():Promise<TeamView[]>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    return listLocalTeams()
  await syncQueuedTeams()
  let after:string|null=null
  for(let i=0;i<100;i++){
    const path:string='/teams/v1'+(after?'?after='+encodeURIComponent(after):'')
    const page:ServerPage=await jsonApi<ServerPage>(path)
    same(s)
    if(!page||!Array.isArray(page.items)||page.items.length>50
      ||page.nextCursor!==null
        &&(typeof page.nextCursor!=='string'||!uuidPattern.test(page.nextCursor)))
      throw Error('teams.invalid_page')
    for(const item of page.items){
      if(!item||item.ownerAccountId!==s.accountId||item.state!=='active'
        ||!Number.isSafeInteger(item.memberCount)||item.memberCount<1)
        throw Error('teams.invalid_server_team')
      const entry:CachedTeam={version:1,teamId:item.teamId,
        ownerAccountId:item.ownerAccountId,contract:item.contract,
        signature:item.signature,memberCount:item.memberCount,delivery:'synced'}
      await store(s,entry)
    }
    if(page.nextCursor===null)return listLocalTeams()
    if(!page.items.length||page.items.length!==50
      ||page.items[49]!.teamId!==page.nextCursor
      ||after!==null&&page.nextCursor<=after)throw Error('teams.invalid_page')
    after=page.nextCursor
  }
  throw Error('teams.pagination_limit')
}
