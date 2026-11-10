import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import {
  b64, unb64, random, digest, hex, uuid, sign, verify, importSigner,
  importSpki, exchangeKey, exportECDHPublic,
} from '../../identity/infrastructure/crypto'
import { pinnedPeer, ensureOwnExchangeKey } from '../../sharing/key-directory'
import { listConfirmedContacts } from './contact-book'
import { withOwnerTeamDEK } from './team-book'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const inviteDomain='pb3.team-invite.v1\n'
const acceptDomain='pb3.team-accept.v1\n'
const createDomain='pb3.team-create.v1\n'
const recipientDomain='pb3.team-recipient-dek.v1\n'
const profileAAD='pb3.team-profile.v1\n'
const localAAD='pb3.team-members-local.v1\n'
const scopePrefix='pb3.team-members-scope.v1\n'
export type TeamRole='curator'|'contributor'|'viewer'
type Envelope={ephemeralSpki:string;salt:string;iv:string;ciphertext:string}
type InviteContract={
  version:1;inviteId:string;operationId:string;teamId:string;ownerAccountId:string
  teamContractHash:string;recipientAccountId:string;role:TeamRole;fileAccess:'none'
  recipientKeyDigest:string;expiresAt:number;envelope:Envelope
}
type AcceptContract={
  version:1;action:'accept';inviteId:string;teamId:string
  recipientAccountId:string;operationId:string;inviteHash:string
}
export type TeamInvitation={
  inviteId:string;teamId:string;ownerAccountId:string;ownerAccountSpki:string
  recipientAccountId:string;role:TeamRole;state:'pending'|'accepted'
  expiresAt:number;expired:boolean;contract:string;signature:string
  contractHash:string;trustedOwner:boolean
}
export type TeamRosterMember={
  inviteId:string;recipientAccountId:string;role:TeamRole;state:'pending'|'accepted'
  expiresAt:number
}
export type JoinedTeam={
  teamId:string;ownerAccountId:string;name:string;description:string
  role:TeamRole;verifiedOnline:boolean
}
type Receipt={inviteId:string;state:'pending'|'accepted';unchanged:boolean}
type Op={version:1;kind:'invite'|'accept';operationId:string;teamId:string
  inviteId:string;contract:string;signature:string
  state:'queued'|'sent'|'conflict';createdAt:number}
type Stored={key:string;ownerScope:string;iv:string;ciphertext:string}
class TeamMembersDB extends Dexie {
  operations!:Table<Stored,string>
  joined!:Table<Stored,string>
  constructor(){
    super('pb3-encrypted-team-members-v1')
    this.version(1).stores({
      operations:'&key,ownerScope',joined:'&key,ownerScope',
    })
  }
}
const db=new TeamMembersDB()
function same(s:Session):void{
  const current=activeSession.value
  if(!current||current.accountId!==s.accountId
    ||current.deviceId!==s.deviceId||current.pkg.akek!==s.pkg.akek
    ||current.pkg.accountSpki!==s.pkg.accountSpki
    ||current.pkg.revision!==s.pkg.revision)throw Error('identity.changed')
}
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function rowId(s:Session,kind:string,id:string){
  const ownerScope=await hash(scopePrefix+s.accountId)
  return {ownerScope,key:await hash(scopePrefix+s.accountId+'\n'+kind+'\n'+id)}
}
async function key(s:Session):Promise<CryptoKey>{
  const raw=unb64(s.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',raw,
    {name:'AES-GCM'},false,['encrypt','decrypt'])}
  finally{raw.fill(0)}
}
async function sealRow(s:Session,kind:'operations'|'joined',id:string,data:unknown):Promise<void>{
  same(s)
  const {ownerScope,key:rowKey}=await rowId(s,kind,id)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,
    additionalData:enc.encode(localAAD+ownerScope+'\n'+rowKey),
    tagLength:128,
  },await key(s),enc.encode(JSON.stringify(data)))
  same(s)
  await db[kind].put({key:rowKey,ownerScope,iv:b64(iv),ciphertext:b64(ciphertext)})
  same(s)
}
async function openRows<T>(s:Session,kind:'operations'|'joined'):Promise<T[]>{
  const ownerScope=await hash(scopePrefix+s.accountId)
  const rows=await db[kind].where('ownerScope').equals(ownerScope).toArray()
  const k=await key(s),values:T[]=[]
  for(const row of rows){
    same(s)
    if(row.ownerScope!==ownerScope||!/^[a-f0-9]{64}$/.test(row.key))
      throw Error('teams.member_cache_scope_invalid')
    let parsed:T
    try{
      const bytes=await crypto.subtle.decrypt({
        name:'AES-GCM',iv:unb64(row.iv,12),
        additionalData:enc.encode(localAAD+row.ownerScope+'\n'+row.key),
        tagLength:128,
      },k,unb64(row.ciphertext))
      parsed=JSON.parse(dec.decode(bytes)) as T
    }catch{throw Error('teams.member_cache_unreadable')}
    if(!parsed||typeof parsed!=='object')throw Error('teams.member_cache_invalid')
    const id=kind==='operations'?(parsed as Op).operationId:(parsed as JoinedTeam).teamId
    if(typeof id!=='string'||(await rowId(s,kind,id)).key!==row.key)
      throw Error('teams.member_cache_scope_invalid')
    values.push(parsed)
  }
  same(s)
  return values
}
function envelopeShape(e:Envelope):void{
  if(!e||typeof e!=='object'||Array.isArray(e)
    ||Object.keys(e).sort().join('|')!=='ciphertext|ephemeralSpki|iv|salt'
    ||typeof e.ephemeralSpki!=='string'||typeof e.salt!=='string'
    ||typeof e.iv!=='string'||typeof e.ciphertext!=='string')
    throw Error('teams.bad_invite_envelope')
  unb64(e.salt,16);unb64(e.iv,12);unb64(e.ciphertext,48)
}
function inviteShape(raw:string):InviteContract{
  let c:InviteContract
  try{c=JSON.parse(raw) as InviteContract}
  catch{throw Error('teams.bad_signed_invite')}
  if(!c||typeof c!=='object'||Array.isArray(c)
    ||Object.keys(c).sort().join('|')!==[
      'version','inviteId','operationId','teamId','ownerAccountId',
      'teamContractHash','recipientAccountId','role','fileAccess',
      'recipientKeyDigest','expiresAt','envelope',
    ].sort().join('|')
    ||c.version!==1||!['curator','contributor','viewer'].includes(c.role)
    ||c.fileAccess!=='none'
    ||![c.inviteId,c.operationId,c.teamId,c.ownerAccountId,c.recipientAccountId]
      .every(x=>typeof x==='string'&&uuidPattern.test(x))
    ||c.ownerAccountId===c.recipientAccountId
    ||typeof c.teamContractHash!=='string'
    ||!/^[a-f0-9]{64}$/.test(c.teamContractHash)
    ||typeof c.recipientKeyDigest!=='string'
    ||!/^[a-f0-9]{64}$/.test(c.recipientKeyDigest)
    ||!Number.isSafeInteger(c.expiresAt)
    ||c.expiresAt<1_500_000_000_000
    ||JSON.stringify(c)!==raw)
    throw Error('teams.bad_signed_invite')
  envelopeShape(c.envelope)
  return c
}
function acceptShape(raw:string):AcceptContract{
  let c:AcceptContract
  try{c=JSON.parse(raw) as AcceptContract}
  catch{throw Error('teams.bad_signed_acceptance')}
  if(!c||c.version!==1||c.action!=='accept'
    ||Object.keys(c).sort().join('|')!==[
      'version','action','inviteId','teamId','recipientAccountId',
      'operationId','inviteHash',
    ].sort().join('|')
    ||![c.inviteId,c.teamId,c.recipientAccountId,c.operationId]
      .every(x=>typeof x==='string'&&uuidPattern.test(x))
    ||typeof c.inviteHash!=='string'||!/^[a-f0-9]{64}$/.test(c.inviteHash)
    ||JSON.stringify(c)!==raw)throw Error('teams.bad_signed_acceptance')
  return c
}
function grantInfo(c:InviteContract):string{
  return recipientDomain+JSON.stringify({
    version:1,teamId:c.teamId,inviteId:c.inviteId,
    ownerAccountId:c.ownerAccountId,recipientAccountId:c.recipientAccountId,
    role:c.role,fileAccess:c.fileAccess,recipientKeyDigest:c.recipientKeyDigest,
    teamContractHash:c.teamContractHash,expiresAt:c.expiresAt,
  })
}
async function signOwned(s:Session,purpose:string,data:unknown):Promise<{contract:string;signature:string}>{
  const contract=JSON.stringify(data)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),purpose+contract)
  same(s)
  return {contract,signature}
}
async function verifyReceived(input:Omit<TeamInvitation,'trustedOwner'>):Promise<TeamInvitation>{
  const s=requireSession()
  const c=inviteShape(input.contract)
  if(c.teamId!==input.teamId||c.inviteId!==input.inviteId
    ||c.recipientAccountId!==s.accountId
    ||c.recipientAccountId!==input.recipientAccountId
    ||c.ownerAccountId!==input.ownerAccountId
    ||c.role!==input.role||c.expiresAt!==input.expiresAt
    ||(input.state!=='pending'&&input.state!=='accepted')
    ||input.expired!==(input.state==='pending'&&c.expiresAt<=Date.now()+30000)
    ||await hash(input.contract)!==input.contractHash
    ||!await verify(await importSpki(input.ownerAccountSpki),
      inviteDomain+input.contract,input.signature))
    throw Error('teams.bad_received_invite')
  let trusted=false
  try{
    const pin=await pinnedPeer(c.ownerAccountId,false)
    trusted=pin.accountSpki===input.ownerAccountSpki
  }catch{ /* Unpinned sender: display only, never accept/decrypt. */ }
  same(s)
  return {...input,trustedOwner:trusted}
}
export async function listIncomingTeamInvites():Promise<TeamInvitation[]>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.invite_inbox_requires_online')
  let after:string|null=null
  const invites:TeamInvitation[]=[]
  for(let n=0;n<100;n++){
    const path:string='/teams/v1/invites/received'
      +(after?'?after='+encodeURIComponent(after):'')
    const page: {items:Omit<TeamInvitation,'trustedOwner'>[];nextCursor:string|null}=
      await jsonApi(path)
    same(s)
    if(!Array.isArray(page.items)||page.items.length>50
      ||page.nextCursor!==null&&typeof page.nextCursor!=='string')
      throw Error('teams.bad_inbox')
    for(const item of page.items){
      const checked=await verifyReceived(item)
      invites.push(checked)
    }
    if(page.nextCursor===null)return invites
    if(page.items.length!==50||page.items[49]!.inviteId!==page.nextCursor
      ||after!==null&&page.nextCursor<=after)throw Error('teams.bad_inbox')
    after=page.nextCursor
  }
  throw Error('teams.inbox_page_limit')
}
export async function listOwnerTeamRoster(teamId:string):Promise<TeamRosterMember[]>{
  const s=requireSession()
  if(!s.online)throw Error('teams.roster_requires_online')
  let after:string|null=null
  const result:TeamRosterMember[]=[]
  const signer=await importSpki(s.pkg.accountSpki)
  for(let n=0;n<100;n++){
    const path:string='/teams/v1/'+encodeURIComponent(teamId)+'/participants'
      +(after?'?after='+encodeURIComponent(after):'')
    const page:{items:Array<TeamRosterMember & {
      contract:string;signature:string;recipientAccountSpki:string
      acceptedContract:string|null;acceptedSignature:string|null
    }>;nextCursor:string|null}=await jsonApi(path)
    same(s)
    if(!Array.isArray(page.items)||page.items.length>50)
      throw Error('teams.bad_roster')
    for(const item of page.items){
      const c=inviteShape(item.contract)
      if(c.inviteId!==item.inviteId||c.teamId!==teamId
        ||c.ownerAccountId!==s.accountId||c.recipientAccountId!==item.recipientAccountId
        ||c.role!==item.role||c.expiresAt!==item.expiresAt
        ||!['pending','accepted'].includes(item.state)
        ||!await verify(signer,inviteDomain+item.contract,item.signature))
        throw Error('teams.untrusted_roster')
      if(item.state==='accepted'){
        if(!item.acceptedContract||!item.acceptedSignature)
          throw Error('teams.consent_missing')
        const a=acceptShape(item.acceptedContract)
        if(a.teamId!==teamId||a.inviteId!==item.inviteId
          ||a.recipientAccountId!==c.recipientAccountId
          ||a.inviteHash!==await hash(item.contract)
          ||!await verify(await importSpki(item.recipientAccountSpki),
            acceptDomain+item.acceptedContract,item.acceptedSignature))
          throw Error('teams.consent_invalid')
      }else if(item.acceptedContract!==null||item.acceptedSignature!==null)
        throw Error('teams.unexpected_consent')
      result.push({inviteId:item.inviteId,recipientAccountId:c.recipientAccountId,
        role:item.role,state:item.state,expiresAt:item.expiresAt})
    }
    if(page.nextCursor===null)return result
    if(page.items.length!==50||page.items[49]!.inviteId!==page.nextCursor
      ||after!==null&&page.nextCursor<=after)throw Error('teams.bad_roster')
    after=page.nextCursor
  }
  throw Error('teams.roster_page_limit')
}
/** Encrypted durable owner-signed invitation outbox, no implicit file grants. */
export async function queueTeamInvitation(
  teamId:string,recipientAccountId:string,role:TeamRole,
):Promise<string>{
  const s=requireSession()
  if(!['curator','contributor','viewer'].includes(role))
    throw Error('teams.invalid_role')
  const contacts=await listConfirmedContacts()
  if(!contacts.some(c=>c.peerAccountId===recipientAccountId))
    throw Error('teams.recipient_must_be_confirmed_contact')
  const peer=await pinnedPeer(recipientAccountId)
  same(s)
  const inviteId=uuid(),operationId=uuid()
  const expiresAt=Date.now()+2*86400000
  const result=await withOwnerTeamDEK(teamId,async(raw,root)=>{
    const teamContractHash=await hash(root.contract)
    const fields={
      version:1 as const,inviteId,operationId,teamId,
      ownerAccountId:s.accountId,teamContractHash,
      recipientAccountId,role,fileAccess:'none' as const,
      recipientKeyDigest:peer.descriptorHash,expiresAt,
    }
    const context=grantInfo({...fields,envelope:{
      ephemeralSpki:'',salt:'',iv:'',ciphertext:'',
    }})
    const ephemeral=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const salt=random(16),iv=random(12)
    const wrappingKey=await exchangeKey(ephemeral.privateKey,peer.exchangeSpki,
      context,salt)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:enc.encode(context),tagLength:128,
    },wrappingKey,raw)
    const c:InviteContract={
      ...fields,envelope:{ephemeralSpki:await exportECDHPublic(ephemeral.publicKey),
        salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)},
    }
    return signOwned(s,inviteDomain,c)
  })
  const c=inviteShape(result.contract)
  const op:Op={version:1,kind:'invite',operationId,teamId,
    inviteId:c.inviteId,contract:result.contract,signature:result.signature,
    state:'queued',createdAt:Date.now()}
  await sealRow(s,'operations',operationId,op)
  return inviteId
}
/** Never change signed bytes on Lost ACK: strict replay, no duplicate membership. */
export async function syncTeamMemberOperations():Promise<void>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))return
  const ops=await openRows<Op>(s,'operations')
  for(const op of ops.filter(x=>x.state==='queued')
    .sort((a,b)=>a.createdAt-b.createdAt)){
    same(s)
    if(op.version!==1||!['invite','accept'].includes(op.kind)
      ||!uuidPattern.test(op.operationId)||!uuidPattern.test(op.teamId)
      ||!uuidPattern.test(op.inviteId))throw Error('teams.outbox_invalid')
    if(op.kind==='invite'){
      const c=inviteShape(op.contract)
      if(c.ownerAccountId!==s.accountId
        ||c.operationId!==op.operationId||c.inviteId!==op.inviteId
        ||!await verify(await importSpki(s.pkg.accountSpki),
          inviteDomain+op.contract,op.signature))
        throw Error('teams.outbox_untrusted')
    }else{
      const c=acceptShape(op.contract)
      if(c.recipientAccountId!==s.accountId
        ||c.operationId!==op.operationId||c.inviteId!==op.inviteId
        ||!await verify(await importSpki(s.pkg.accountSpki),
          acceptDomain+op.contract,op.signature))
        throw Error('teams.outbox_untrusted')
    }
    const url='/teams/v1/'+encodeURIComponent(op.teamId)+'/invites'
      +(op.kind==='accept'?'/'+encodeURIComponent(op.inviteId)+'/accept':'')
    try{
      const ack=await jsonApi<Receipt>(url,'POST',
        {contract:op.contract,signature:op.signature})
      same(s)
      if(ack.inviteId!==op.inviteId||ack.state!==
          (op.kind==='invite'?'pending':'accepted')
        ||typeof ack.unchanged!=='boolean')
        throw Error('teams.invalid_operation_ack')
      await sealRow(s,'operations',op.operationId,{...op,state:'sent'})
    }catch(e){
      same(s)
      if(e instanceof Error&&e.message==='api.http_409'){
        await sealRow(s,'operations',op.operationId,{...op,state:'conflict'})
      }else throw e
    }
  }
}
/** Consent is signed by the actual recipient, after independent trust. */
export async function queueTeamAcceptance(invite:TeamInvitation):Promise<string>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.accept_requires_online')
  const checked=await verifyReceived({
    inviteId:invite.inviteId,teamId:invite.teamId,
    ownerAccountId:invite.ownerAccountId,ownerAccountSpki:invite.ownerAccountSpki,
    recipientAccountId:invite.recipientAccountId,role:invite.role,
    state:invite.state,expiresAt:invite.expiresAt,expired:invite.expired,
    contract:invite.contract,signature:invite.signature,
    contractHash:invite.contractHash,
  })
  if(!checked.trustedOwner||invite.state!=='pending'
    ||invite.expiresAt<=Date.now())throw Error('teams.untrusted_or_expired_invite')
  const pin=await pinnedPeer(checked.ownerAccountId)
  if(pin.accountSpki!==checked.ownerAccountSpki)throw Error('teams.owner_key_changed')
  const own=await ensureOwnExchangeKey()
  const c=inviteShape(checked.contract)
  if(own.directory.descriptorHash!==c.recipientKeyDigest)
    throw Error('teams.recipient_key_changed')
  // Prove the ECDH envelope is actually decryptable BEFORE giving consent.
  const wrap=await exchangeKey(own.privateKey,c.envelope.ephemeralSpki,
    grantInfo(c),unb64(c.envelope.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(c.envelope.iv,12),
    additionalData:enc.encode(grantInfo(c)),tagLength:128,
  },wrap,unb64(c.envelope.ciphertext,48)))
  try{if(raw.length!==32)throw Error('teams.wrong_team_dek')}
  finally{raw.fill(0)}
  const operationId=uuid()
  const accept:AcceptContract={
    version:1,action:'accept',inviteId:c.inviteId,teamId:c.teamId,
    recipientAccountId:s.accountId,operationId,inviteHash:checked.contractHash,
  }
  const signed=await signOwned(s,acceptDomain,accept)
  await sealRow(s,'operations',operationId,{
    version:1,kind:'accept',operationId,teamId:c.teamId,
    inviteId:c.inviteId,contract:signed.contract,signature:signed.signature,
    state:'queued',createdAt:Date.now(),
  } satisfies Op)
  return operationId
}
/** Accepted member-only server response: requires current ACL and a verified
 * owner signature + independently pinned identity before exposing plaintext.
 */
export async function openJoinedTeam(invite:TeamInvitation):Promise<JoinedTeam>{
  const s=requireSession()
  if(!s.online)throw Error('teams.member_requires_online')
  if(invite.state!=='accepted')throw Error('teams.not_accepted')
  const checked=await verifyReceived({
    inviteId:invite.inviteId,teamId:invite.teamId,
    ownerAccountId:invite.ownerAccountId,ownerAccountSpki:invite.ownerAccountSpki,
    recipientAccountId:invite.recipientAccountId,role:invite.role,
    state:invite.state,expiresAt:invite.expiresAt,expired:invite.expired,
    contract:invite.contract,signature:invite.signature,
    contractHash:invite.contractHash,
  })
  if(!checked.trustedOwner)throw Error('teams.untrusted_owner')
  const pin=await pinnedPeer(checked.ownerAccountId)
  if(pin.accountSpki!==checked.ownerAccountSpki)throw Error('teams.owner_key_changed')
  const own=await ensureOwnExchangeKey()
  const c=inviteShape(checked.contract)
  if(own.directory.descriptorHash!==c.recipientKeyDigest)
    throw Error('teams.recipient_key_changed')
  const response:{
    teamId:string;ownerAccountId:string;ownerAccountSpki:string
    contract:string;signature:string
    invite:{inviteId:string;contract:string;signature:string;contractHash:string;role:string}
  }=await jsonApi('/teams/v1/'+encodeURIComponent(c.teamId)+'/member')
  same(s)
  if(response.teamId!==c.teamId||response.ownerAccountId!==c.ownerAccountId
    ||response.ownerAccountSpki!==pin.accountSpki
    ||response.invite.inviteId!==c.inviteId
    ||response.invite.contract!==checked.contract
    ||response.invite.signature!==checked.signature
    ||response.invite.role!==c.role
    ||response.invite.contractHash!==checked.contractHash
    ||await hash(response.contract)!==c.teamContractHash
    ||!await verify(await importSpki(pin.accountSpki),
      createDomain+response.contract,response.signature))
    throw Error('teams.untrusted_team_root')
  let root:{version:number;teamId:string;ownerAccountId:string
    privateEnvelope:{version:number;iv:string;ciphertext:string}}
  try{root=JSON.parse(response.contract) as typeof root}
  catch{throw Error('teams.invalid_team_root')}
  if(root.version!==1||root.teamId!==c.teamId
    ||root.ownerAccountId!==c.ownerAccountId
    ||root.privateEnvelope?.version!==1)throw Error('teams.invalid_team_root')
  const wrapping=await exchangeKey(own.privateKey,c.envelope.ephemeralSpki,
    grantInfo(c),unb64(c.envelope.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(c.envelope.iv,12),
    additionalData:enc.encode(grantInfo(c)),tagLength:128,
  },wrapping,unb64(c.envelope.ciphertext,48)))
  let plain:ArrayBuffer
  try{
    if(raw.length!==32)throw Error('teams.invalid_member_dek')
    const dek=await crypto.subtle.importKey('raw',raw,
      {name:'AES-GCM'},false,['decrypt'])
    plain=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(root.privateEnvelope.iv,12),
      additionalData:enc.encode(profileAAD+c.ownerAccountId+'\n'+c.teamId),
      tagLength:128,
    },dek,unb64(root.privateEnvelope.ciphertext))
  }finally{raw.fill(0)}
  let data:{name:string;description:string}
  try{data=JSON.parse(dec.decode(plain)) as typeof data}
  catch{throw Error('teams.member_profile_invalid')}
  if(!data||typeof data.name!=='string'
    ||typeof data.description!=='string'
    ||Object.keys(data).sort().join('|')!=='description|name'
    ||data.name.trim()!==data.name||!data.name||data.name.length>64
    ||data.description.trim()!==data.description||data.description.length>1024)
    throw Error('teams.member_profile_invalid')
  same(s)
  const joined:JoinedTeam={teamId:c.teamId,ownerAccountId:c.ownerAccountId,
    name:data.name,description:data.description,role:c.role,verifiedOnline:true}
  await sealRow(s,'joined',c.teamId,joined)
  return joined
}
export async function listCachedJoinedTeams():Promise<JoinedTeam[]>{
  const s=requireSession()
  const rows=await openRows<JoinedTeam>(s,'joined')
  return rows.map(row=>{
    if(!uuidPattern.test(row.teamId)||!uuidPattern.test(row.ownerAccountId)
      ||typeof row.name!=='string'||typeof row.description!=='string'
      ||!['curator','contributor','viewer'].includes(row.role))
      throw Error('teams.joined_cache_invalid')
    return {...row,verifiedOnline:false}
  })
}
