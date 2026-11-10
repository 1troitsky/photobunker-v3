import Dexie, {type Table} from 'dexie'
import {activeSession,requireSession} from '../../identity/application/session'
import type {Session} from '../../identity/application/session'
import {jsonApi} from '../../identity/infrastructure/api'
import {
  b64,unb64,random,digest,hex,uuid,sign,verify,importSpki,importSigner,
  exchangeKey,exportECDHPublic,
} from '../../identity/infrastructure/crypto'
import {pinnedPeer,ensureOwnExchangeKey} from '../../sharing/key-directory'
import {listConfirmedContacts} from './contact-book'
import {
  withCurrentOwnerTeamDEK,verifyEpochHistory,profileAad,ownerEpochStatus,
  openVerifiedCurrentEpochMember,
} from './team-epochs'
import {cacheVerifiedJoinedTeam,verifiedTeamMembershipHistory} from './team-invitations'
import type {TeamRole,TeamInvitation,TeamRosterMember,JoinedTeam} from './team-invitations'

const enc=new TextEncoder()
const dec=new TextDecoder('utf-8',{fatal:true})
const uuidRe=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digestRe=/^[a-f0-9]{64}$/
const inviteDomain='pb3.team-invite.v2\n'
const acceptDomain='pb3.team-accept.v2\n'
const mutationDomain='pb3.team-membership.v1\n'
const wrapDomain='pb3.team-invite-epoch-dek.v2\n'
const localDomain='pb3.team-v2-local.v1\n'
const scopeDomain='pb3.team-v2-scope.v1\n'

type Envelope={ephemeralSpki:string;salt:string;iv:string;ciphertext:string}
type InviteContract={
  version:2;inviteId:string;operationId:string;teamId:string;ownerAccountId:string
  rootContractHash:string;keyEpoch:number;keyEpochHash:string
  membershipRevision:number;recipientAccountId:string
  role:TeamRole;fileAccess:'none';recipientKeyDigest:string
  expiresAt:number;envelope:Envelope
}
type ConsentContract={
  version:2;action:'accept';inviteId:string;teamId:string
  recipientAccountId:string;operationId:string;inviteHash:string
  keyEpoch:number;keyEpochHash:string
}
type MembershipChange={
  version:1;operationId:string;teamId:string;ownerAccountId:string
  inviteId:string;targetAccountId:string;action:'remove'|'change_role'
  previousRole:TeamRole;nextRole:TeamRole|null
  fromRevision:number;toRevision:number
}
export type EpochTeamInvite=TeamInvitation & {
  version:2;keyEpoch:number;membershipRevision:number
}
export type EpochRosterMember=TeamRosterMember & {
  protocolVersion:2;keyEpoch:number
}
export type SupersededInvite={
  inviteId:string;teamId:string;ownerAccountId:string
  ownerAccountSpki:string;state:'superseded'
}
type MinimalNotice={inviteId:string;teamId:string;state:'revoked'|'suspended'}
type RawIncoming=Omit<EpochTeamInvite,'trustedOwner'|'version'>|MinimalNotice|SupersededInvite
export type EpochIncoming={
  invites:EpochTeamInvite[];revokedTeamIds:string[]
  suspendedTeamIds:string[];superseded:SupersededInvite[]
}
type Operation={
  version:1;kind:'invite'|'accept'|'membership'
  teamId:string;inviteId:string;operationId:string
  contract:string;signature:string;state:'queued'|'sent'|'conflict'
  createdAt:number
}
type Stored={key:string;scope:string;iv:string;ciphertext:string}
class EpochInviteDB extends Dexie{
  operations!:Table<Stored,string>
  constructor(){
    super('pb3-encrypted-team-invites-v2')
    this.version(1).stores({operations:'&key,scope'})
  }
}
const db=new EpochInviteDB()
function same(s:Session):void{
  const now=activeSession.value
  if(!now||now.accountId!==s.accountId||now.deviceId!==s.deviceId
    ||now.pkg.akek!==s.pkg.akek||now.pkg.accountSpki!==s.pkg.accountSpki
    ||now.pkg.revision!==s.pkg.revision)throw Error('identity.changed')
}
async function hash(text:string):Promise<string>{
  return hex(await digest(enc.encode(text)))
}
async function key(s:Session):Promise<CryptoKey>{
  const b=unb64(s.pkg.akek,32)
  try{return await crypto.subtle.importKey('raw',b,
    {name:'AES-GCM'},false,['encrypt','decrypt'])}
  finally{b.fill(0)}
}
async function rowId(s:Session,id:string){
  const scope=await hash(scopeDomain+s.accountId)
  return {scope,key:await hash(scopeDomain+s.accountId+'\n'+id)}
}
async function store(s:Session,op:Operation):Promise<void>{
  same(s)
  const {key:rowKey,scope}=await rowId(s,op.operationId)
  const iv=random(12)
  const ciphertext=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,
    additionalData:enc.encode(localDomain+scope+'\n'+rowKey),
    tagLength:128,
  },await key(s),enc.encode(JSON.stringify(op)))
  same(s)
  await db.operations.put({
    key:rowKey,scope,iv:b64(iv),ciphertext:b64(ciphertext),
  })
  same(s)
}
async function operations(s:Session):Promise<Operation[]>{
  const {scope}=await rowId(s,'scope')
  const rows=await db.operations.where('scope').equals(scope).toArray()
  const k=await key(s),out:Operation[]=[]
  for(const row of rows){
    same(s)
    if(row.scope!==scope||!digestRe.test(row.key))
      throw Error('teams.invite_v2_cache_scope')
    let value:Operation
    try{
      const raw=await crypto.subtle.decrypt({
        name:'AES-GCM',iv:unb64(row.iv,12),
        additionalData:enc.encode(localDomain+scope+'\n'+row.key),
        tagLength:128,
      },k,unb64(row.ciphertext))
      value=JSON.parse(dec.decode(raw)) as Operation
    }catch{throw Error('teams.invite_v2_cache_unreadable')}
    if(value.version!==1
      ||!['invite','accept','membership'].includes(value.kind)
      ||!['queued','sent','conflict'].includes(value.state)
      ||!uuidRe.test(value.operationId)||!uuidRe.test(value.teamId)
      ||!uuidRe.test(value.inviteId)
      ||(await rowId(s,value.operationId)).key!==row.key)
      throw Error('teams.invite_v2_cache_invalid')
    out.push(value)
  }
  return out
}
function envelopeCheck(e:Envelope):void{
  if(!e||typeof e!=='object'||Array.isArray(e)
    ||Object.keys(e).sort().join('|')!=='ciphertext|ephemeralSpki|iv|salt'
    ||typeof e.ephemeralSpki!=='string'||typeof e.salt!=='string'
    ||typeof e.iv!=='string'||typeof e.ciphertext!=='string')
    throw Error('teams.invite_v2_envelope_invalid')
  unb64(e.salt,16);unb64(e.iv,12);unb64(e.ciphertext,48)
}
function inviteShape(raw:string):InviteContract{
  let c:InviteContract
  try{c=JSON.parse(raw) as InviteContract}
  catch{throw Error('teams.invite_v2_invalid')}
  if(!c||typeof c!=='object'||Array.isArray(c)
    ||Object.keys(c).sort().join('|')!==[
      'version','inviteId','operationId','teamId','ownerAccountId',
      'rootContractHash','keyEpoch','keyEpochHash','membershipRevision',
      'recipientAccountId','role','fileAccess','recipientKeyDigest',
      'expiresAt','envelope',
    ].sort().join('|')||c.version!==2
    ||![c.inviteId,c.operationId,c.teamId,c.ownerAccountId,c.recipientAccountId]
      .every(x=>typeof x==='string'&&uuidRe.test(x))
    ||c.ownerAccountId===c.recipientAccountId
    ||!['curator','contributor','viewer'].includes(c.role)
    ||c.fileAccess!=='none'
    ||![c.rootContractHash,c.keyEpochHash,c.recipientKeyDigest]
      .every(x=>typeof x==='string'&&digestRe.test(x))
    ||!Number.isInteger(c.keyEpoch)||c.keyEpoch<2||c.keyEpoch>1000001
    ||!Number.isInteger(c.membershipRevision)||c.membershipRevision<2
    ||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<1_500_000_000_000
    ||JSON.stringify(c)!==raw)throw Error('teams.invite_v2_invalid')
  envelopeCheck(c.envelope)
  return c
}
function acceptShape(raw:string):ConsentContract{
  let c:ConsentContract
  try{c=JSON.parse(raw) as ConsentContract}
  catch{throw Error('teams.consent_v2_invalid')}
  if(!c||c.version!==2||c.action!=='accept'
    ||Object.keys(c).sort().join('|')!==[
      'version','action','inviteId','teamId','recipientAccountId',
      'operationId','inviteHash','keyEpoch','keyEpochHash',
    ].sort().join('|')
    ||![c.inviteId,c.teamId,c.recipientAccountId,c.operationId]
      .every(x=>typeof x==='string'&&uuidRe.test(x))
    ||!digestRe.test(c.inviteHash)||!digestRe.test(c.keyEpochHash)
    ||!Number.isInteger(c.keyEpoch)||c.keyEpoch<2
    ||JSON.stringify(c)!==raw)throw Error('teams.consent_v2_invalid')
  return c
}
function info(c:InviteContract):string{
  return wrapDomain+JSON.stringify({
    version:2,inviteId:c.inviteId,operationId:c.operationId,
    teamId:c.teamId,ownerAccountId:c.ownerAccountId,
    recipientAccountId:c.recipientAccountId,role:c.role,
    fileAccess:c.fileAccess,recipientKeyDigest:c.recipientKeyDigest,
    rootContractHash:c.rootContractHash,keyEpoch:c.keyEpoch,
    keyEpochHash:c.keyEpochHash,membershipRevision:c.membershipRevision,
    expiresAt:c.expiresAt,
  })
}
async function signed(s:Session,domain:string,value:object){
  const contract=JSON.stringify(value)
  const signature=await sign(await importSigner(s.pkg.accountPkcs8),
    domain+contract)
  same(s)
  return {contract,signature}
}
async function verifiedInvite(
  i:Omit<EpochTeamInvite,'trustedOwner'|'version'>,
):Promise<EpochTeamInvite>{
  const s=requireSession()
  const c=inviteShape(i.contract)
  if(c.inviteId!==i.inviteId||c.teamId!==i.teamId
    ||c.ownerAccountId!==i.ownerAccountId
    ||c.recipientAccountId!==i.recipientAccountId
    ||c.recipientAccountId!==s.accountId
    ||c.keyEpoch!==i.keyEpoch||c.membershipRevision!==i.membershipRevision
    ||c.role!==i.role||c.expiresAt!==i.expiresAt
    ||!['pending','accepted'].includes(i.state)
    ||typeof i.expired!=='boolean'
    ||await hash(i.contract)!==i.contractHash
    ||!await verify(await importSpki(i.ownerAccountSpki),
      inviteDomain+i.contract,i.signature))
    throw Error('teams.untrusted_epoch_invitation')
  let trusted=false
  try{
    const pin=await pinnedPeer(c.ownerAccountId,false)
    trusted=pin.accountSpki===i.ownerAccountSpki
  }catch{/* Sender unconfirmed: display only, never decrypt/accept. */}
  same(s)
  return {...i,version:2,
    expired:i.state==='pending'&&c.expiresAt<=Date.now(),
    trustedOwner:trusted}
}

export async function listEpochInvites():Promise<EpochIncoming>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.epoch_inbox_requires_online')
  let after:string|null=null
  const result:EpochIncoming={
    invites:[],revokedTeamIds:[],suspendedTeamIds:[],superseded:[],
  }
  for(let n=0;n<100;n++){
    const path='/teams/v2/invites/received'
      +(after?'?after='+encodeURIComponent(after):'')
    const page:{items:RawIncoming[];nextCursor:string|null}=await jsonApi(path)
    same(s)
    if(!Array.isArray(page.items)||page.items.length>50
      ||page.nextCursor!==null
        &&(typeof page.nextCursor!=='string'||!uuidRe.test(page.nextCursor)))
      throw Error('teams.invalid_epoch_inbox')
    for(const item of page.items){
      if(item.state==='revoked'||item.state==='suspended'){
        if(Object.keys(item).sort().join('|')!=='inviteId|state|teamId'
          ||!uuidRe.test(item.inviteId)||!uuidRe.test(item.teamId))
          throw Error('teams.invalid_epoch_notice')
        if(item.state==='revoked')result.revokedTeamIds.push(item.teamId)
        else result.suspendedTeamIds.push(item.teamId)
      }else if(item.state==='superseded'){
        if(Object.keys(item).sort().join('|')
          !=='inviteId|ownerAccountId|ownerAccountSpki|state|teamId'
          ||!uuidRe.test(item.inviteId)||!uuidRe.test(item.teamId)
          ||!uuidRe.test(item.ownerAccountId))
          throw Error('teams.invalid_epoch_superseded')
        result.superseded.push(item)
      }else{
        result.invites.push(await verifiedInvite(
          item as Omit<EpochTeamInvite,'trustedOwner'|'version'>))
      }
    }
    if(page.nextCursor===null)return result
    if(page.items.length!==50
      ||page.items[49]!.inviteId!==page.nextCursor
      ||after!==null&&page.nextCursor<=after)
      throw Error('teams.invalid_epoch_inbox')
    after=page.nextCursor
  }
  throw Error('teams.epoch_inbox_limit')
}
/** Issue a new ECDH-wrapped grant under the actual current Team DEK, not the
 * original root DEK. Persist the signed operation BEFORE any POST.
 */
export async function queueEpochInvitation(
  teamId:string,recipientAccountId:string,role:TeamRole,
):Promise<string>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.epoch_invite_requires_online')
  if(!uuidRe.test(teamId)||!uuidRe.test(recipientAccountId)
    ||!['curator','contributor','viewer'].includes(role))
    throw Error('teams.epoch_invite_invalid')
  const contacts=await listConfirmedContacts()
  if(!contacts.some(c=>c.peerAccountId===recipientAccountId))
    throw Error('teams.recipient_must_be_confirmed_contact')
  const peer=await pinnedPeer(recipientAccountId)
  same(s)
  const inviteId=uuid(),operationId=uuid(),expiresAt=Date.now()+2*86400000
  const command=await withCurrentOwnerTeamDEK(teamId,async(raw,scope)=>{
    const fields={
      version:2 as const,inviteId,operationId,teamId,
      ownerAccountId:s.accountId,
      rootContractHash:scope.rootContractHash,
      keyEpoch:scope.keyEpoch,keyEpochHash:scope.keyEpochHash,
      membershipRevision:scope.membershipRevision,
      recipientAccountId,role,fileAccess:'none' as const,
      recipientKeyDigest:peer.descriptorHash,expiresAt,
    }
    const placeholder:InviteContract={
      ...fields,envelope:{ephemeralSpki:'',salt:'',iv:'',ciphertext:''},
    }
    const context=info(placeholder)
    const ephemeral=await crypto.subtle.generateKey(
      {name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    const salt=random(16),iv=random(12)
    const wrap=await exchangeKey(ephemeral.privateKey,peer.exchangeSpki,
      context,salt)
    const ciphertext=await crypto.subtle.encrypt({
      name:'AES-GCM',iv,additionalData:enc.encode(context),tagLength:128,
    },wrap,raw)
    return signed(s,inviteDomain,{
      ...fields,envelope:{
        ephemeralSpki:await exportECDHPublic(ephemeral.publicKey),
        salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext),
      },
    })
  })
  const c=inviteShape(command.contract)
  await store(s,{version:1,kind:'invite',
    teamId,inviteId:c.inviteId,operationId:c.operationId,
    ...command,state:'queued',createdAt:Date.now()})
  return inviteId
}
export async function queueEpochAcceptance(item:EpochTeamInvite):Promise<string>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))
    throw Error('teams.epoch_accept_requires_online')
  const checked=await verifiedInvite(item)
  if(!checked.trustedOwner||checked.state!=='pending'
    ||checked.expiresAt<=Date.now())
    throw Error('teams.untrusted_epoch_invitation')
  const pin=await pinnedPeer(checked.ownerAccountId)
  if(pin.accountSpki!==checked.ownerAccountSpki)
    throw Error('teams.epoch_owner_key_changed')
  const own=await ensureOwnExchangeKey()
  const c=inviteShape(checked.contract)
  if(own.directory.descriptorHash!==c.recipientKeyDigest)
    throw Error('teams.epoch_recipient_key_changed')
  const context=info(c)
  const wrap=await exchangeKey(own.privateKey,c.envelope.ephemeralSpki,
    context,unb64(c.envelope.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(c.envelope.iv,12),
    additionalData:enc.encode(context),tagLength:128,
  },wrap,unb64(c.envelope.ciphertext,48)))
  try{if(raw.length!==32)throw Error('teams.epoch_wrong_dek')}
  finally{raw.fill(0)}
  const operationId=uuid()
  const command=await signed(s,acceptDomain,{
    version:2,action:'accept',inviteId:c.inviteId,teamId:c.teamId,
    recipientAccountId:s.accountId,operationId,
    inviteHash:checked.contractHash,
    keyEpoch:c.keyEpoch,keyEpochHash:c.keyEpochHash,
  } satisfies ConsentContract)
  await store(s,{version:1,kind:'accept',
    teamId:c.teamId,inviteId:c.inviteId,operationId,
    ...command,state:'queued',createdAt:Date.now()})
  return operationId
}

/** Exact signed operation is immutable; after Lost ACK the same payload is
 * replayed, never signed again. A 409 stays an explicit conflict.
 */
export async function syncEpochInvitationOperations():Promise<void>{
  const s=requireSession()
  if(!s.online||(typeof navigator!=='undefined'&&!navigator.onLine))return
  const ops=await operations(s)
  for(const op of ops.filter(x=>x.state==='queued')
    .sort((a,b)=>a.createdAt-b.createdAt)){
    same(s)
    let url:string
    if(op.kind==='invite'){
      const c=inviteShape(op.contract)
      if(c.ownerAccountId!==s.accountId
        ||c.operationId!==op.operationId||c.inviteId!==op.inviteId
        ||!await verify(await importSpki(s.pkg.accountSpki),
          inviteDomain+op.contract,op.signature))
        throw Error('teams.untrusted_epoch_outbox')
      url='/teams/v2/'+encodeURIComponent(op.teamId)+'/invites'
    }else if(op.kind==='accept'){
      const c=acceptShape(op.contract)
      if(c.recipientAccountId!==s.accountId
        ||c.operationId!==op.operationId||c.inviteId!==op.inviteId
        ||!await verify(await importSpki(s.pkg.accountSpki),
          acceptDomain+op.contract,op.signature))
        throw Error('teams.untrusted_epoch_outbox')
      url='/teams/v2/'+encodeURIComponent(op.teamId)
        +'/invites/'+encodeURIComponent(op.inviteId)+'/accept'
    }else{
      let c:MembershipChange
      try{c=JSON.parse(op.contract) as MembershipChange}
      catch{throw Error('teams.untrusted_epoch_outbox')}
      if(c.version!==1||c.ownerAccountId!==s.accountId
        ||c.operationId!==op.operationId||c.inviteId!==op.inviteId
        ||c.teamId!==op.teamId
        ||!await verify(await importSpki(s.pkg.accountSpki),
          mutationDomain+op.contract,op.signature))
        throw Error('teams.untrusted_epoch_outbox')
      url='/teams/v1/'+encodeURIComponent(op.teamId)+'/membership'
    }
    try{
      const ack:{
        inviteId?:string;state?:string;keyEpoch?:number;unchanged:boolean
        operationId?:string;membershipRevision?:number;rotationRequired?:boolean
      }=await jsonApi(url,'POST',{
        contract:op.contract,signature:op.signature,
      })
      same(s)
      if(typeof ack.unchanged!=='boolean')throw Error('teams.epoch_ack_invalid')
      if(op.kind==='membership'){
        const c=JSON.parse(op.contract) as MembershipChange
        if(ack.operationId!==op.operationId
          ||!Number.isInteger(ack.membershipRevision)
          ||(ack.membershipRevision??0)<c.toRevision
          ||typeof ack.rotationRequired!=='boolean')
          throw Error('teams.epoch_membership_ack_invalid')
      }else{
        const c=op.kind==='invite'
          ?inviteShape(op.contract):acceptShape(op.contract)
        if(ack.inviteId!==op.inviteId
          ||ack.state!==(op.kind==='invite'?'pending':'accepted')
          ||ack.keyEpoch!==c.keyEpoch)
          throw Error('teams.epoch_invitation_ack_invalid')
      }
      await store(s,{...op,state:'sent'})
    }catch(e){
      same(s)
      if(e instanceof Error&&e.message==='api.http_409')
        await store(s,{...op,state:'conflict'})
      else throw e
    }
  }
}

/** Owner-only signed v2 roster. A revoked historical invite remains a
 * signed record; only the current accepted member carries live ACL.
 */
export async function listOwnerEpochRoster(teamId:string):Promise<EpochRosterMember[]>{
  const s=requireSession()
  if(!s.online)throw Error('teams.epoch_roster_requires_online')
  const [history,status]=await Promise.all([
    verifiedTeamMembershipHistory(teamId),ownerEpochStatus(teamId),
  ])
  if(status.membershipRevision!==history.revision
    ||status.rotationRequired!==history.rotationRequired)
    throw Error('teams.epoch_roster_revision_changed')
  const signer=await importSpki(s.pkg.accountSpki)
  let after:string|null=null
  const roster:EpochRosterMember[]=[]
  for(let n=0;n<100;n++){
    const path='/teams/v2/'+encodeURIComponent(teamId)+'/participants'
      +(after?'?after='+encodeURIComponent(after):'')
    const page:{items:Array<{
      inviteId:string;recipientAccountId:string;recipientAccountSpki:string
      role:TeamRole;effectiveRole:TeamRole;state:'pending'|'accepted'|'revoked'
      keyEpoch:number;membershipRevision:number;expiresAt:number
      contract:string;signature:string
      acceptedContract:string|null;acceptedSignature:string|null
    }>;nextCursor:string|null}=await jsonApi(path)
    same(s)
    if(!Array.isArray(page.items)||page.items.length>50
      ||page.nextCursor!==null
        &&(typeof page.nextCursor!=='string'||!uuidRe.test(page.nextCursor)))
      throw Error('teams.invalid_epoch_roster')
    for(const item of page.items){
      const c=inviteShape(item.contract)
      if(c.teamId!==teamId||c.ownerAccountId!==s.accountId
        ||c.inviteId!==item.inviteId
        ||c.recipientAccountId!==item.recipientAccountId
        ||c.role!==item.role||c.keyEpoch!==item.keyEpoch
        ||c.membershipRevision!==item.membershipRevision
        ||c.expiresAt!==item.expiresAt
        ||c.keyEpoch>status.keyEpoch
        ||!['pending','accepted','revoked'].includes(item.state)
        ||!await verify(signer,inviteDomain+item.contract,item.signature))
        throw Error('teams.untrusted_epoch_roster')
      if(item.acceptedContract!==null||item.acceptedSignature!==null){
        if(!item.acceptedContract||!item.acceptedSignature)
          throw Error('teams.epoch_roster_missing_consent')
        const receipt=acceptShape(item.acceptedContract)
        if(receipt.inviteId!==c.inviteId||receipt.teamId!==teamId
          ||receipt.recipientAccountId!==c.recipientAccountId
          ||receipt.inviteHash!==await hash(item.contract)
          ||receipt.keyEpoch!==c.keyEpoch
          ||receipt.keyEpochHash!==c.keyEpochHash
          ||!await verify(await importSpki(item.recipientAccountSpki),
            acceptDomain+item.acceptedContract,item.acceptedSignature))
          throw Error('teams.epoch_roster_untrusted_consent')
      }else if(item.state==='accepted')
        throw Error('teams.epoch_roster_missing_consent')
      let derivedRole:TeamRole=c.role
      let signedRevoked=false
      for(const e of history.events.filter(x=>x.inviteId===c.inviteId)){
        if(e.targetAccountId!==c.recipientAccountId
          ||e.previousRole!==derivedRole||signedRevoked)
          throw Error('teams.invalid_epoch_membership_chain')
        if(e.action==='remove')signedRevoked=true
        else derivedRole=e.nextRole as TeamRole
      }
      // A pending invite may also be invalidated by a newer key epoch,
      // without any signed explicit member-removal event.
      const autoExpired=c.keyEpoch<status.keyEpoch
        &&item.acceptedContract===null
      if(item.effectiveRole!==derivedRole
        ||(item.state==='revoked'&&!signedRevoked&&!autoExpired)
        ||(signedRevoked&&item.state!=='revoked'))
        throw Error('teams.epoch_roster_acl_mismatch')
      roster.push({
        inviteId:c.inviteId,recipientAccountId:c.recipientAccountId,
        role:derivedRole,state:item.state,expiresAt:c.expiresAt,
        protocolVersion:2,keyEpoch:c.keyEpoch,
      })
    }
    if(page.nextCursor===null)return roster
    if(page.items.length!==50
      ||page.items[49]!.inviteId!==page.nextCursor
      ||after!==null&&page.nextCursor<=after)
      throw Error('teams.invalid_epoch_roster')
    after=page.nextCursor
  }
  throw Error('teams.epoch_roster_limit')
}

export async function queueEpochMembershipChange(
  teamId:string,member:EpochRosterMember,
  action:'change_role'|'remove',nextRole:TeamRole|null,
):Promise<string>{
  const s=requireSession()
  const [roster,history]=await Promise.all([
    listOwnerEpochRoster(teamId),verifiedTeamMembershipHistory(teamId),
  ])
  const existing=roster.find(x=>x.inviteId===member.inviteId
    &&x.recipientAccountId===member.recipientAccountId)
  if(!existing||existing.role!==member.role
    ||existing.state!==member.state||existing.state==='revoked'
    ||history.rotationRequired
    ||action==='change_role'&&(existing.state!=='accepted'
      ||nextRole===existing.role
      ||!['curator','contributor','viewer'].includes(nextRole as string))
    ||action==='remove'&&nextRole!==null)
    throw Error('teams.invalid_epoch_membership_change')
  const operationId=uuid()
  const payload:MembershipChange={
    version:1,operationId,teamId,ownerAccountId:s.accountId,
    inviteId:existing.inviteId,targetAccountId:existing.recipientAccountId,
    action,previousRole:existing.role,nextRole,
    fromRevision:history.revision,toRevision:history.revision+1,
  }
  const command=await signed(s,mutationDomain,payload)
  await store(s,{version:1,kind:'membership',
    teamId,inviteId:existing.inviteId,operationId,
    ...command,state:'queued',createdAt:Date.now()})
  return operationId
}

/** The joined member verifies owner root + all signed epoch links *after*
 * server consent has established access to the authenticated history.
 */
export async function openJoinedEpochInvite(item:EpochTeamInvite):Promise<JoinedTeam>{
  const s=requireSession()
  if(!s.online||item.state!=='accepted')throw Error('teams.epoch_member_requires_online')
  const checked=await verifiedInvite(item)
  if(!checked.trustedOwner)throw Error('teams.untrusted_epoch_owner')
  const owner=await pinnedPeer(checked.ownerAccountId)
  if(owner.accountSpki!==checked.ownerAccountSpki)
    throw Error('teams.epoch_owner_key_changed')
  const invitation=inviteShape(checked.contract)
  let response:{
    teamId:string;ownerAccountId:string;ownerAccountSpki:string
    membershipRevision:number;keyEpoch:number;keyEpochHash:string
    effectiveRole:TeamRole
    invite:{
      contract:string;signature:string;contractHash:string
      acceptedContract:string;acceptedSignature:string
    }
    epoch:{contract:string;signature:string;contractHash:string}
    latestRoleEvent:{contract:string;signature:string}|null
  }
  try{
    response=await jsonApi('/teams/v2/'+encodeURIComponent(item.teamId)+'/member')
  }catch(e){
    if(e instanceof Error&&e.message==='api.http_404'){
      // Member can survive another rotation; in that case the direct
      // current-epoch grant replaces the historical signed v2 envelope.
      return openVerifiedCurrentEpochMember(
        item.teamId,item.ownerAccountId,invitation.rootContractHash)
    }
    throw e
  }
  same(s)
  if(response.teamId!==invitation.teamId
    ||response.ownerAccountId!==invitation.ownerAccountId
    ||response.ownerAccountSpki!==owner.accountSpki
    ||response.keyEpoch!==invitation.keyEpoch
    ||response.keyEpochHash!==invitation.keyEpochHash
    ||response.invite.contract!==checked.contract
    ||response.invite.signature!==checked.signature
    ||response.invite.contractHash!==checked.contractHash)
    throw Error('teams.untrusted_epoch_member')
  const receipt=acceptShape(response.invite.acceptedContract)
  if(receipt.teamId!==invitation.teamId
    ||receipt.inviteId!==invitation.inviteId
    ||receipt.recipientAccountId!==s.accountId
    ||receipt.keyEpoch!==invitation.keyEpoch
    ||receipt.keyEpochHash!==invitation.keyEpochHash
    ||receipt.inviteHash!==checked.contractHash
    ||!await verify(await importSpki(s.pkg.accountSpki),
      acceptDomain+response.invite.acceptedContract,
      response.invite.acceptedSignature))
    throw Error('teams.untrusted_epoch_consent')
  const chain=await verifyEpochHistory(invitation.teamId,
    invitation.ownerAccountId,owner.accountSpki,invitation.rootContractHash)
  const epoch=chain.latest
  if(!epoch||chain.epoch!==invitation.keyEpoch
    ||chain.contractHash!==invitation.keyEpochHash
    ||chain.rotationRequired
    ||chain.membershipRevision!==response.membershipRevision
    ||response.epoch.contractHash!==chain.contractHash
    ||response.epoch.contract!==JSON.stringify(epoch)
    ||!await verify(await importSpki(owner.accountSpki),
      'pb3.team-key-epoch.v1\n'+response.epoch.contract,
      response.epoch.signature))
    throw Error('teams.untrusted_epoch_chain')
  const own=await ensureOwnExchangeKey()
  if(own.directory.descriptorHash!==invitation.recipientKeyDigest)
    throw Error('teams.epoch_key_changed')
  const context=info(invitation)
  const wrapping=await exchangeKey(own.privateKey,
    invitation.envelope.ephemeralSpki,
    context,unb64(invitation.envelope.salt,16))
  const raw=new Uint8Array(await crypto.subtle.decrypt({
    name:'AES-GCM',iv:unb64(invitation.envelope.iv,12),
    additionalData:enc.encode(context),tagLength:128,
  },wrapping,unb64(invitation.envelope.ciphertext,48)))
  let plaintext:ArrayBuffer
  try{
    if(raw.length!==32)throw Error('teams.invalid_epoch_join_key')
    const key=await crypto.subtle.importKey('raw',raw,
      {name:'AES-GCM'},false,['decrypt'])
    plaintext=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(epoch.privateEnvelope.iv,12),
      additionalData:profileAad(epoch),tagLength:128,
    },key,unb64(epoch.privateEnvelope.ciphertext))
  }finally{raw.fill(0)}
  let profile:{name:string;description:string}
  try{profile=JSON.parse(dec.decode(plaintext)) as typeof profile}
  catch{throw Error('teams.epoch_join_profile_invalid')}
  if(!profile||typeof profile.name!=='string'
    ||!profile.name||profile.name.trim()!==profile.name
    ||profile.name.length>64||typeof profile.description!=='string'
    ||profile.description.trim()!==profile.description
    ||profile.description.length>1024
    ||Object.keys(profile).sort().join('|')!=='description|name')
    throw Error('teams.epoch_join_profile_invalid')
  let role:TeamRole=invitation.role
  if(response.latestRoleEvent){
    let event:MembershipChange
    try{event=JSON.parse(response.latestRoleEvent.contract) as MembershipChange}
    catch{throw Error('teams.untrusted_epoch_join_role')}
    if(event.action!=='change_role'
      ||event.ownerAccountId!==invitation.ownerAccountId
      ||event.teamId!==invitation.teamId
      ||event.inviteId!==invitation.inviteId
      ||event.targetAccountId!==s.accountId
      ||event.toRevision<=invitation.membershipRevision
      ||event.toRevision>response.membershipRevision
      ||!['curator','contributor','viewer'].includes(event.nextRole as string)
      ||!await verify(await importSpki(owner.accountSpki),
        mutationDomain+response.latestRoleEvent.contract,
        response.latestRoleEvent.signature))
      throw Error('teams.untrusted_epoch_join_role')
    role=event.nextRole as TeamRole
  }
  if(role!==response.effectiveRole)
    throw Error('teams.epoch_join_role_mismatch')
  same(s)
  const joined:JoinedTeam={
    teamId:invitation.teamId,ownerAccountId:invitation.ownerAccountId,
    name:profile.name,description:profile.description,role,verifiedOnline:true,
  }
  await cacheVerifiedJoinedTeam(joined,s.accountId)
  return joined
}
