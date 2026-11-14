/**
 * #209: public, owner-intended policy targets, NOT an authenticated media grant.
 * Store only allowed media types / optional progress goals; never plaintext
 * title, instructions, DEKs, GPS or private capture metadata.
 *
 * The immutable v1 root is photo-only. Video/audio may be enabled ONLY by
 * a later owner-signed v6 revision after the server ACKs that root.
 */
export type MixedCreationMedia = 'photo'|'video'|'audio'
export type MixedCreationIntent = {
  allowedMedia:MixedCreationMedia[]
  videoGoal:number|null
  audioGoal:number|null
}
export type MixedCreationStage =
  'pending-root'|'ready-to-sign'|'pending-policy'|'accepted'|'conflict'

type State='queued'|'retry'|'sent'|'conflict'
export type VerifiedMixedPolicy = {
  policyRevision:number
  allowedMedia:MixedCreationMedia[]
  videoGoal:number|null
  audioGoal:number|null
}

/** Canonical signed-policy media ordering matters for exact signatures. */
export function validMixedCreationIntent(input:unknown):input is MixedCreationIntent {
  if(!input||typeof input!=='object'||Array.isArray(input))return false
  const x=input as Record<string,unknown>
  const media=x.allowedMedia
  if(!Array.isArray(media)||![
    ['photo','video'],['photo','audio'],['photo','video','audio'],
  ].some(v=>JSON.stringify(v)===JSON.stringify(media)))return false
  const goal=(v:unknown)=>v===null||(typeof v==='number'
    &&Number.isInteger(v)&&v>=1&&v<=999)
  return goal(x.videoGoal)&&goal(x.audioGoal)
    &&(media.includes('video')||x.videoGoal===null)
    &&(media.includes('audio')||x.audioGoal===null)
}

/** Never infer an accepted policy from only a local signed outbox operation. */
export function mixedCreationStage(
  intent:MixedCreationIntent,
  rootState:State,
  policyState:State|null,
  verifiedServerPolicy:VerifiedMixedPolicy|null,
):MixedCreationStage {
  if(!validMixedCreationIntent(intent))throw Error('assignment.invalid_mixed_intent')
  if(rootState==='conflict')return 'conflict'
  if(rootState!=='sent'||!verifiedServerPolicy)return 'pending-root'
  const server=verifiedServerPolicy
  if(server.policyRevision>1){
    return JSON.stringify(server.allowedMedia)===JSON.stringify(intent.allowedMedia)
      &&server.videoGoal===intent.videoGoal&&server.audioGoal===intent.audioGoal
      ?'accepted':'conflict'
  }
  if(server.policyRevision!==1||policyState==='conflict')return 'conflict'
  if(policyState!==null)return 'pending-policy'
  return 'ready-to-sign'
}

/** Explicitly parse optional progress goals; never silently coerce bad input. */
export function optionalMixedGoal(raw:string|number):number|null {
  const value=String(raw).trim()
  if(!value)return null
  const n=Number(value)
  if(!Number.isInteger(n)||n<1||n>999)throw Error('assignment.invalid_goal')
  return n
}
