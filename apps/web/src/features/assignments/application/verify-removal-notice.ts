import {importSpki,verify} from '../../identity/infrastructure/crypto'
import {pinnedPeer} from '../../sharing/key-directory'
import type {SignedDirectory} from '../../sharing/key-directory'

export type AssignmentRemovalNotice={
  inviteId:string;assignmentId:string;ownerAccountId:string
  recipientAccountId:string;ownerAccountSpki:string
  invitationContract:string;invitationSignature:string
  removalContract:string;removalSignature:string
}
export type CheckedAssignmentRemovalNotice={
  notice:AssignmentRemovalNotice;verified:boolean
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const inviteFields=['version','inviteId','assignmentId','ownerAccountId',
  'recipientAccountId','recipientKeyDigest','role','expiresAt','envelope']
const removeFields=['version','action','operationId','assignmentId',
  'inviteId','ownerAccountId','recipientAccountId']
function exactContract(raw:string,fields:string[]):Record<string,unknown>{
  if(typeof raw!=='string'||raw.length<60||raw.length>30000)
    throw Error('assignment.removal_notice_unverified')
  let parsed:unknown
  try{parsed=JSON.parse(raw)}catch{throw Error('assignment.removal_notice_unverified')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    throw Error('assignment.removal_notice_unverified')
  const result=parsed as Record<string,unknown>
  if(Object.keys(result).sort().join('|')!==fields.slice().sort().join('|')
    ||JSON.stringify(result)!==raw)
    throw Error('assignment.removal_notice_unverified')
  return result
}
/**
 * Only the independently fingerprint-confirmed owner can authenticate
 * exclusion. Neither a server-only removed flag nor a supplied signing key
 * is trusted. No plaintext or E2EE material in this message.
 */
export async function verifyAssignmentRemovalNotice(
  item:AssignmentRemovalNotice,recipientId:string,
  peer?:SignedDirectory,
):Promise<void>{
  if(!item||![
    item.inviteId,item.assignmentId,item.ownerAccountId,
    item.recipientAccountId,
  ].every(x=>typeof x==='string'&&uuid.test(x))
    ||item.ownerAccountId===recipientId
    ||item.recipientAccountId!==recipientId
    ||typeof item.ownerAccountSpki!=='string'
    ||typeof item.invitationSignature!=='string'
    ||typeof item.removalSignature!=='string')
    throw Error('assignment.removal_notice_unverified')
  const invite=exactContract(item.invitationContract,inviteFields)
  const removal=exactContract(item.removalContract,removeFields)
  if(invite.version!==1||invite.role!=='contributor'
    ||invite.inviteId!==item.inviteId
    ||invite.assignmentId!==item.assignmentId
    ||invite.ownerAccountId!==item.ownerAccountId
    ||invite.recipientAccountId!==item.recipientAccountId
    ||removal.version!==1||removal.action!=='remove'
    ||removal.inviteId!==item.inviteId
    ||removal.assignmentId!==item.assignmentId
    ||removal.ownerAccountId!==item.ownerAccountId
    ||removal.recipientAccountId!==recipientId
    ||typeof removal.operationId!=='string'
    ||!uuid.test(removal.operationId))
    throw Error('assignment.removal_notice_unverified')
  const pinned=peer??await pinnedPeer(item.ownerAccountId)
  if(pinned.accountId!==item.ownerAccountId
    ||pinned.accountSpki!==item.ownerAccountSpki)
    throw Error('assignment.removal_notice_unverified')
  const key=await importSpki(pinned.accountSpki)
  if(!await verify(key,'pb3.assignment-invite.v1\n'
      +item.invitationContract,item.invitationSignature)
    ||!await verify(key,'pb3.assignment-member-remove.v1\n'
      +item.removalContract,item.removalSignature))
    throw Error('assignment.removal_notice_unverified')
}
/** Each notice has its own signature, directory lookup shared per owner. */
export async function inspectAssignmentRemovalNotices(
  items:AssignmentRemovalNotice[],recipientId:string,
):Promise<CheckedAssignmentRemovalNotice[]>{
  const owners=new Map<string,Promise<SignedDirectory>>()
  return Promise.all(items.map(async notice=>{
    try{
      let pin=owners.get(notice.ownerAccountId)
      if(!pin){
        pin=pinnedPeer(notice.ownerAccountId)
        owners.set(notice.ownerAccountId,pin)
      }
      await verifyAssignmentRemovalNotice(notice,recipientId,await pin)
      return {notice,verified:true}
    }catch{
      return {notice,verified:false}
    }
  }))
}
