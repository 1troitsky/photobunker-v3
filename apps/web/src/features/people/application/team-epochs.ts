import Dexie, { type Table } from 'dexie'
import { activeSession, requireSession } from '../../identity/application/session'
import type { Session } from '../../identity/application/session'
import { jsonApi } from '../../identity/infrastructure/api'
import {
  b64, unb64, random, digest, hex, uuid, importSpki, importSigner, sign, verify,
  exchangeKey, exportECDHPublic,
} from '../../identity/infrastructure/crypto'
import { pinnedPeer, ensureOwnExchangeKey } from '../../sharing/key-directory'
import { listLocalTeams } from './team-book'
import {
  listOwnerTeamRoster, verifiedTeamMembershipHistory, openJoinedTeam,
  cacheVerifiedJoinedTeam,
} from './team-invitations'
import type { TeamRole, TeamInvitation, JoinedTeam } from './team-invitations'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const hashPattern=/^[a-f0-9]{64}$/
const epochDomain='pb3.team-key-epoch.v1\n'
const createDomain='pb3.team-create.v1\n'
const roleDomain='pb3.team-membership.v1\n'
const ownerAadPrefix='pb3.team-owner-key-epoch.v1\n'
const profileAadPrefix='pb3.team-profile-epoch.v1\n'
const recipientDomain='pb3.team-epoch-recipient-dek.v1\n'
const localAadPrefix='pb3.team-epoch-local.v1\n'
const localScopePrefix='pb3.team-epoch-scope.v1\n'

type Cipher={iv:string;ciphertext:string}
type PrivateEnvelope=Cipher&{version:1;wrappedKey:Cipher}
type RecipientEnvelope={ephemeralSpki:string;salt:string;iv:string;ciphertext:string}
type EpochRecipient={
  accountId:string;role:TeamRole;recipientKeyDigest:string;envelope:RecipientEnvelope
}
type EpochContract={
  version:1;operationId:string;teamId:string;ownerAccountId:string
  fromEpoch:number;toEpoch:number;membershipRevision:number
  previousEpochHash:string;privateEnvelope:PrivateEnvelope
  recipients:EpochRecipient[]
}
type Root={contract:string;signature:string;contractHash:string}
type HistoryPage={
  teamId:string;ownerAccountId:string;membershipRevision:number
  keyEpoch:number;rotationRequired:boolean;root:Root
  items:Array<{keyEpoch:number;contract:string;signature:string;contractHash:string}>
  nextCursor:number|null
}
type OwnerEpoch={
  teamId:string;ownerAccountId:string;membershipRevision:number
  keyEpoch:number;rotationRequired:boolean
  contract:string;signature:string;contractHash:string;domain:string
}
type RecipientEpoch=OwnerEpoch & {
  effectiveRole:TeamRole
  latestRoleEvent:{contract:string;signature:string}|null
  recipient?:{accountId:string;role:TeamRole;recipientKeyDigest:string;envelope:RecipientEnvelope}
}
type EpochOperation={
  version:1;operationId:string;teamId:string;contract:string;signature:string
  state:'queued'|'synced'|'conflict'
}
type Stored={key:string;ownerScope:string;iv:string;ciphertext:string}
class EpochDB extends Dexie{
  operations!:Table<Stored,string>
  constructor(){
    super('pb3-encrypted-team-epochs-v1')
    this.version(1).stores({operations:'&key,ownerScope'})
  }
}
const db=new EpochDB()
function same(s:Session):void{
  const current=activeSession.value
  if(!current||current.accountId!==s.accountId||current.deviceId!==s.deviceId
    ||current.pkg.akek!==s.pkg.akek
    ||current.pkg.accountSpki!==s.pkg.accountSpki
    ||current.pkg.revision!==s.pkg.revision)throw Error('identity.changed')
}
async function hash(raw:string):Promise<string>{
  return hex(await digest(enc.encode(raw)))
}
function ownerAad(owner:string,team:string,epoch:number,revision:number):Uint8Array<ArrayBuffer>{
  return enc.encode(ownerAadPrefix+owner+'\n'+team+'\n'+epoch+'\n'+revision)
}
function profileAad(c:Pick<EpochContract,'ownerAccountId'|'teamId'|'toEpoch'|'membershipRevision'|'previousEpochHash'>):Uint8Array<ArrayBuffer>{
  return enc.encode(profileAadPrefix+c.ownerAccountId+'\n'+c.teamId+'\n'
    +c.toEpoch+'\n'+c.membershipRevision+'\n'+c.previousEpochHash)
}
function recipientInfo(c:EpochContract,r:Pick<EpochRecipient,'accountId'|'role'|'recipientKeyDigest'>):string{
  return recipientDomain+JSON.stringify({
    version:1,teamId:c.teamId,fromEpoch:c.fromEpoch,toEpoch:c.toEpoch,
    ownerAccountId:c.ownerAccountId,recipientAccountId:r.accountId,
    role:r.role,recipientKeyDigest:r.recipientKeyDigest,
    membershipRevision:c.membershipRevision,previousEpochHash:c.previousEpochHash,
  })
}
function validateEnvelope(v:RecipientEnvelope):void{
  if(!v||typeof v!=='object'||Array.isArray(v)
    ||Object.keys(v).sort().join('|')!=='ciphertext|ephemeralSpki|iv|salt'
    ||typeof v.ephemeralSpki!=='string'||typeof v.salt!=='string'
    ||typeof v.iv!=='string'||typeof v.ciphertext!=='string')
    throw Error('teams.invalid_epoch_recipient_envelope')
  unb64(v.salt,16);unb64(v.iv,12);unb64(v.ciphertext,48)
}
function parseEpoch(raw:string):EpochContract{
  let c:EpochContract
  try{c=JSON.parse(raw) as EpochContract}
  catch{throw Error('teams.invalid_epoch_contract')}
  if(!c||typeof c!=='object'||Array.isArray(c)
    ||Object.keys(c).sort().join('|')!==[
      'version','operationId','teamId','ownerAccountId','fromEpoch','toEpoch',
      'membershipRevision','previousEpochHash','privateEnvelope','recipients',
    ].sort().join('|')
    ||c.version!==1||![c.operationId,c.teamId,c.ownerAccountId]
      .every(x=>typeof x==='string'&&uuidPattern.test(x))
    ||!Number.isInteger(c.fromEpoch)||c.fromEpoch<1
    ||!Number.isInteger(c.toEpoch)||c.toEpoch!==c.fromEpoch+1
    ||!Number.isInteger(c.membershipRevision)||c.membershipRevision<2
    ||typeof c.previousEpochHash!=='string'||!hashPattern.test(c.previousEpochHash)
    ||!c.privateEnvelope||typeof c.privateEnvelope!=='object'
    ||Object.keys(c.privateEnvelope).sort().join('|')
      !=='ciphertext|iv|version|wrappedKey'
    ||c.privateEnvelope.version!==1
    ||!c.privateEnvelope.wrappedKey
    ||Object.keys(c.privateEnvelope.wrappedKey).sort().join('|')!=='ciphertext|iv'
    ||!Array.isArray(c.recipients)||c.recipients.length>100
    ||JSON.stringify(c)!==raw)
    throw Error('teams.invalid_epoch_contract')
  unb64(c.privateEnvelope.iv,12)
  unb64(c.privateEnvelope.wrappedKey.iv,12)
  unb64(c.privateEnvelope.wrappedKey.ciphertext,48)
  const ciphertext=unb64(c.privateEnvelope.ciphertext)
  if(ciphertext.length<32||ciphertext.length>4096)
    throw Error('teams.invalid_epoch_contract')
  let previous=''
  for(const r of c.recipients){
    if(!r||typeof r!=='object'||Array.isArray(r)
      ||Object.keys(r).sort().join('|')
        !=='accountId|envelope|recipientKeyDigest|role'
      ||typeof r.accountId!=='string'||!uuidPattern.test(r.accountId)
      ||r.accountId<=previous
      ||!['curator','contributor','viewer'].includes(r.role)
      ||typeof r.recipientKeyDigest!=='string'
      ||!hashPattern.test(r.recipientKeyDigest))
      throw Error('teams.invalid_epoch_recipients')
    previous=r.accountId
    validateEnvelope(r.envelope)
  }
  return c
}
async function verifyEpochHistory(
  teamId:string,ownerAccountId:string,ownerAccountSpki:string,originalRootHash:string,
):Promise<{epoch:number;contractHash:string;latest:EpochContract|null;root:Root;
  membershipRevision:number;rotationRequired:boolean}>{
  const s=requireSession()
  const signer=await importSpki(ownerAccountSpki)
  let after=1,currentHash='',revision:number|null=null,epoch:number|null=null
  let required:boolean|null=null,root:Root|null=null,latest:EpochContract|null=null
  for(let i=0;i<100;i++){
    const url='/teams/v1/'+encodeURIComponent(teamId)+'/epoch/history'
      +(after>1?'?after='+after:'')
    const page:HistoryPage=await jsonApi(url)
    same(s)
    if(page.teamId!==teamId||page.ownerAccountId!==ownerAccountId
      ||!Number.isInteger(page.keyEpoch)||page.keyEpoch<1
      ||!Number.isInteger(page.membershipRevision)||page.membershipRevision<1
      ||typeof page.rotationRequired!=='boolean'
      ||!Array.isArray(page.items)||page.items.length>50
      ||page.nextCursor!==null&&!Number.isInteger(page.nextCursor)
      ||epoch!==null&&epoch!==page.keyEpoch
      ||revision!==null&&revision!==page.membershipRevision
      ||required!==null&&required!==page.rotationRequired)
      throw Error('teams.invalid_epoch_history')
    epoch=page.keyEpoch;revision=page.membershipRevision;required=page.rotationRequired
    if(!root){
      root=page.root
      if(!root||typeof root.contract!=='string'
        ||root.contractHash!==originalRootHash
        ||await hash(root.contract)!==root.contractHash
        ||!await verify(signer,createDomain+root.contract,root.signature))
        throw Error('teams.untrusted_epoch_origin')
      let origin:{teamId:string;ownerAccountId:string;version:number}
      try{origin=JSON.parse(root.contract) as typeof origin}
      catch{throw Error('teams.untrusted_epoch_origin')}
      if(origin.teamId!==teamId||origin.ownerAccountId!==ownerAccountId
        ||origin.version!==1)throw Error('teams.untrusted_epoch_origin')
      currentHash=root.contractHash
    }else if(page.root.contract!==root.contract
      ||page.root.contractHash!==root.contractHash
      ||page.root.signature!==root.signature)throw Error('teams.changed_epoch_origin')
    for(const item of page.items){
      const c=parseEpoch(item.contract)
      if(item.keyEpoch!==after+1||c.fromEpoch!==after||c.toEpoch!==after+1
        ||c.teamId!==teamId||c.ownerAccountId!==ownerAccountId
        ||c.previousEpochHash!==currentHash
        ||item.contractHash!==await hash(item.contract)
        ||!await verify(signer,epochDomain+item.contract,item.signature))
        throw Error('teams.untrusted_epoch_chain')
      after=c.toEpoch
      currentHash=item.contractHash
      latest=c
    }
    if(page.nextCursor===null){
      if(after!==epoch||!root)throw Error('teams.incomplete_epoch_chain')
      return {epoch,contractHash:currentHash,latest,root,
        membershipRevision:revision,rotationRequired:required}
    }
    if(page.items.length!==50||page.nextCursor!==after)
      throw Error('teams.incomplete_epoch_chain')
  }
  throw Error('teams.epoch_chain_limit')
}
async function localKey(s:Session):Promise<CryptoKey>{
  const bytes=unb64(s.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',bytes,
    {name:'AES-GCM'},false,['encrypt','decrypt'])}
  finally{bytes.fill(0)}
}
async function localId(s:Session,id:string){
  const ownerScope=await hash(localScopePrefix+s.accountId)
  const key=await hash(localScopePrefix+s.accountId+'\n'+id)
  return {ownerScope,key}
}
async function persist(s:Session,op:EpochOperation):Promise<void>{
  same(s)
  const {key,ownerScope}=await localId(s,op.operationId)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:enc.encode(localAadPrefix+ownerScope+'\n'+key),
    tagLength:128,
  },await localKey(s),enc.encode(JSON.stringify(op)))
  same(s)
  await db.operations.put({key,ownerScope,iv:b64(iv),ciphertext:b64(ciphertext)})
  same(s)
}
async function cachedOperations(s:Session):Promise<EpochOperation[]>{
  const {ownerScope}=await localId(s,'scope')
  const rows=await db.operations.where('ownerScope').equals(ownerScope).toArray()
  const k=await localKey(s),ops:EpochOperation[]=[]
  for(const row of rows){
    same(s)
    if(row.ownerScope!==ownerScope)throw Error('teams.invalid_epoch_cache')
    let op:EpochOperation
    try{
      const bytes=await crypto.subtle.decrypt({
        name:'AES-GCM',iv:unb64(row.iv,12),
        additionalData:enc.encode(localAadPrefix+ownerScope+'\n'+row.key),
        tagLength:128,
      },k,unb64(row.ciphertext))
      op=JSON.parse(dec.decode(bytes)) as EpochOperation
    }catch{throw Error('teams.invalid_epoch_cache')}
    if(!op||op.version!==1||!uuidPattern.test(op.operationId)
      ||!uuidPattern.test(op.teamId)
      ||(await localId(s,op.operationId)).key!==row.key)
      throw Error('teams.invalid_epoch_cache')
    ops.push(op)
  }
  return ops
}
export async function ownerEpochStatus(teamId:string):Promise<OwnerEpoch>{
  const s=requireSession()
  if(!s.online)throw Error('teams.epoch_requires_online')
  const status:OwnerEpoch=await jsonApi('/teams/v1/'+encodeURIComponent(teamId)+'/epoch/owner')
  same(s)
  if(status.teamId!==teamId||status.ownerAccountId!==s.accountId
    ||!Number.isInteger(status.membershipRevision)
    ||!Number.isInteger(status.keyEpoch)||status.keyEpoch<1
    ||typeof status.rotationRequired!=='boolean'
    ||typeof status.contract!=='string'
    ||typeof status.contractHash!=='string'||!hashPattern.test(status.contractHash)
    ||await hash(status.contract)!==status.contractHash
    ||!await verify(await importSpki(s.pkg.accountSpki),
      (status.keyEpoch===1?createDomain:epochDomain)+status.contract,
      status.signature))
    throw Error('teams.untrusted_owner_epoch')
  return status
}
/** Durable, account-encrypted signed epoch operation MUST exist before HTTP. */
export async function queueTeamKeyRotation(teamId:string):Promise<string>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.rotation_requires_online_roster')
  const existing=await cachedOperations(s)
  if(existing.some(op=>op.teamId===teamId&&op.state==='queued'))
    throw Error('teams.rotation_already_queued')
  const [status,history,members,local]=await Promise.all([
    ownerEpochStatus(teamId),verifiedTeamMembershipHistory(teamId),
    listOwnerTeamRoster(teamId),listLocalTeams(),
  ])
  same(s)
  if(!status.rotationRequired||!history.rotationRequired
    ||history.revision!==status.membershipRevision)
    throw Error('teams.rotation_not_required')
  const team=local.find(x=>x.teamId===teamId&&x.delivery==='synced')
  if(!team)throw Error('teams.team_profile_not_cached')
  const current=await verifyEpochHistory(teamId,s.accountId,s.pkg.accountSpki,
    status.keyEpoch===1?status.contractHash:
      // For a previously rotated team, root is independently fetched from
      // a previously signed/verified v1 local team root in next call.
      await originalRootHash(teamId))
  if(current.epoch!==status.keyEpoch||current.contractHash!==status.contractHash
    ||current.membershipRevision!==history.revision
    ||current.rotationRequired!==true)
    throw Error('teams.stale_epoch_roster')
  const surviving=members.filter(x=>x.state==='accepted')
    .sort((a,b)=>a.recipientAccountId.localeCompare(b.recipientAccountId))
  if(surviving.length>100)throw Error('teams.epoch_roster_limit')
  const toEpoch=status.keyEpoch+1
  const operationId=uuid()
  const keyBytes=random(32)
  try{
    const dek=await crypto.subtle.importKey('raw',keyBytes,
      {name:'AES-GCM'},false,['encrypt'])
    const frame={
      ownerAccountId:s.accountId,teamId,toEpoch,
      membershipRevision:history.revision,previousEpochHash:current.contractHash,
    }
    const iv=random(12),ownerIv=random(12)
    const profile=JSON.stringify({name:team.name,description:team.description})
    const [encryptedProfile,wrappedOwner]=await Promise.all([
      crypto.subtle.encrypt({name:'AES-GCM',iv,
        additionalData:profileAad(frame),tagLength:128},
        dek,enc.encode(profile)),
      crypto.subtle.encrypt({name:'AES-GCM',iv:ownerIv,
        additionalData:ownerAad(s.accountId,teamId,toEpoch,history.revision),
        tagLength:128},await localKey(s),keyBytes),
    ])
    const privateEnvelope:PrivateEnvelope={
      version:1,iv:b64(iv),ciphertext:b64(encryptedProfile),
      wrappedKey:{iv:b64(ownerIv),ciphertext:b64(wrappedOwner)},
    }
    const header:EpochContract={
      version:1,operationId,teamId,ownerAccountId:s.accountId,
      fromEpoch:status.keyEpoch,toEpoch,
      membershipRevision:history.revision,
      previousEpochHash:current.contractHash,privateEnvelope,recipients:[],
    }
    for(const member of surviving){
      const peer=await pinnedPeer(member.recipientAccountId)
      same(s)
      const ephemeral=await crypto.subtle.generateKey(
        {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
      const recipientFrame={
        accountId:member.recipientAccountId,role:member.role,
        recipientKeyDigest:peer.descriptorHash,
      }
      const context=recipientInfo(header,recipientFrame)
      const salt=random(16),recipientIv=random(12)
      const wrap=await exchangeKey(ephemeral.privateKey,peer.exchangeSpki,context,salt)
      const wrapped=await crypto.subtle.encrypt({
        name:'AES-GCM',iv:recipientIv,
        additionalData:enc.encode(context),tagLength:128,
      },wrap,keyBytes)
      header.recipients.push({
        ...recipientFrame,envelope:{
          ephemeralSpki:await exportECDHPublic(ephemeral.publicKey),
          salt:b64(salt),iv:b64(recipientIv),ciphertext:b64(wrapped),
        },
      })
    }
    const contract=JSON.stringify(header)
    const signature=await sign(await importSigner(s.pkg.accountPkcs8),
      epochDomain+contract)
    same(s)
    await persist(s,{
      version:1,operationId,teamId,contract,signature,state:'queued',
    })
    return operationId
  }finally{keyBytes.fill(0)}
}
async function originalRootHash(teamId:string):Promise<string>{
  // The original Team owner ciphertext is immutable; verify it from the
  // owner's signed server history, not from mutable client-side metadata.
  const s=requireSession()
  const page:HistoryPage=await jsonApi(
    '/teams/v1/'+encodeURIComponent(teamId)+'/epoch/history')
  same(s)
  if(page.teamId!==teamId||page.ownerAccountId!==s.accountId
    ||!page.root||typeof page.root.contract!=='string'
    ||await hash(page.root.contract)!==page.root.contractHash
    ||!await verify(await importSpki(s.pkg.accountSpki),
      createDomain+page.root.contract,page.root.signature))
    throw Error('teams.untrusted_epoch_origin')
  return page.root.contractHash
}
export async function syncTeamKeyRotations():Promise<void>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))return
  const ops=await cachedOperations(s)
  for(const op of ops.filter(x=>x.state==='queued')){
    const c=parseEpoch(op.contract)
    if(c.operationId!==op.operationId||c.teamId!==op.teamId
      ||c.ownerAccountId!==s.accountId
      ||!await verify(await importSpki(s.pkg.accountSpki),
        epochDomain+op.contract,op.signature))
      throw Error('teams.untrusted_epoch_outbox')
    same(s)
    try{
      const ack:{teamId:string;keyEpoch:number;unchanged:boolean}=
        await jsonApi('/teams/v1/'+encodeURIComponent(op.teamId)+'/epoch',
          'POST',{contract:op.contract,signature:op.signature})
      same(s)
      if(ack.teamId!==op.teamId||ack.keyEpoch!==c.toEpoch
        ||typeof ack.unchanged!=='boolean')
        throw Error('teams.invalid_epoch_ack')
      await persist(s,{...op,state:'synced'})
    }catch(e){
      same(s)
      if(e instanceof Error&&e.message==='api.http_409')
        await persist(s,{...op,state:'conflict'})
      else throw e
    }
  }
}
export async function openAnyJoinedTeam(invite:TeamInvitation):Promise<JoinedTeam>{
  const s=requireSession()
  const path='/teams/v1/'+encodeURIComponent(invite.teamId)+'/epoch/member'
  const response:RecipientEpoch=await jsonApi(path)
  same(s)
  if(response.teamId!==invite.teamId
    ||!Number.isInteger(response.keyEpoch)||response.keyEpoch<1)
    throw Error('teams.invalid_epoch_member')
  if(response.keyEpoch===1)return openJoinedTeam(invite)
  if(!invite.trustedOwner||invite.state!=='accepted')
    throw Error('teams.untrusted_member_epoch')
  const peer=await pinnedPeer(invite.ownerAccountId)
  if(peer.accountSpki!==invite.ownerAccountSpki)
    throw Error('teams.owner_key_changed')
  let original:{teamContractHash:string;teamId:string;ownerAccountId:string}
  try{original=JSON.parse(invite.contract) as typeof original}
  catch{throw Error('teams.bad_member_invite')}
  if(original.teamId!==invite.teamId
    ||original.ownerAccountId!==invite.ownerAccountId
    ||!hashPattern.test(original.teamContractHash))
    throw Error('teams.bad_member_invite')
  const chain=await verifyEpochHistory(invite.teamId,invite.ownerAccountId,
    peer.accountSpki,original.teamContractHash)
  const c=chain.latest
  if(!c||chain.epoch!==response.keyEpoch
    ||chain.contractHash!==response.contractHash
    ||chain.rotationRequired
    ||chain.membershipRevision!==response.membershipRevision
    ||response.ownerAccountId!==invite.ownerAccountId
    ||response.contract!==JSON.stringify(c)
    ||response.recipient?.accountId!==s.accountId
    ||!['curator','contributor','viewer'].includes(response.effectiveRole))
    throw Error('teams.untrusted_member_epoch')
  const r=c.recipients.find(x=>x.accountId===s.accountId)
  if(!r||!response.recipient
    ||JSON.stringify(r)!==JSON.stringify(response.recipient))
    throw Error('teams.missing_member_epoch_grant')
  const own=await ensureOwnExchangeKey()
  if(own.directory.descriptorHash!==r.recipientKeyDigest)
    throw Error('teams.member_epoch_key_changed')
  const info=recipientInfo(c,r)
  const key=await exchangeKey(own.privateKey,r.envelope.ephemeralSpki,
    info,unb64(r.envelope.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(r.envelope.iv,12),
    additionalData:enc.encode(info),tagLength:128,
  },key,unb64(r.envelope.ciphertext,48)))
  let plaintext:ArrayBuffer
  try{
    if(raw.length!==32)throw Error('teams.invalid_member_epoch_dek')
    const dek=await crypto.subtle.importKey('raw',raw,
      {name:'AES-GCM'},false,['decrypt'])
    plaintext=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(c.privateEnvelope.iv,12),
      additionalData:profileAad(c),tagLength:128,
    },dek,unb64(c.privateEnvelope.ciphertext))
  }finally{raw.fill(0)}
  let profile:{name:string;description:string}
  try{profile=JSON.parse(dec.decode(plaintext)) as typeof profile}
  catch{throw Error('teams.member_epoch_profile_invalid')}
  if(!profile||typeof profile.name!=='string'
    ||!profile.name||profile.name.trim()!==profile.name||profile.name.length>64
    ||typeof profile.description!=='string'
    ||profile.description.trim()!==profile.description
    ||profile.description.length>1024)
    throw Error('teams.member_epoch_profile_invalid')
  let role:TeamRole=r.role
  if(response.latestRoleEvent){
    let event:{
      action:string;teamId:string;targetAccountId:string
      ownerAccountId:string;inviteId:string;nextRole:TeamRole
      toRevision:number
    }
    try{event=JSON.parse(response.latestRoleEvent.contract) as typeof event}
    catch{throw Error('teams.untrusted_member_role_epoch')}
    if(event.action!=='change_role'
      ||event.teamId!==c.teamId||event.ownerAccountId!==c.ownerAccountId
      ||event.targetAccountId!==s.accountId
      ||!Number.isInteger(event.toRevision)
      ||event.toRevision>response.membershipRevision
      ||!await verify(await importSpki(peer.accountSpki),
        roleDomain+response.latestRoleEvent.contract,
        response.latestRoleEvent.signature))
      throw Error('teams.untrusted_member_role_epoch')
    role=event.nextRole
  }
  if(response.effectiveRole!==role)
    throw Error('teams.untrusted_member_effective_role')
  same(s)
  const joined:JoinedTeam={
    teamId:c.teamId,ownerAccountId:c.ownerAccountId,
    name:profile.name,description:profile.description,
    role,verifiedOnline:true,
  }
  await cacheVerifiedJoinedTeam(joined)
  return joined
}
