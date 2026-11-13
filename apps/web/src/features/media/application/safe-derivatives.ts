import Dexie,{type Table} from 'dexie'
import {requireSession} from '../../identity/application/session'
import {sha} from '../../local-storage/infrastructure/cipher'
import {listLocalMedia} from './media-outbox'
import type {StoredMedia} from './media-outbox'

/**
 * Only opaque media IDs/contract hashes are stored locally: no original image
 * bytes, GPS, names, masked coordinates or plaintext edit history.
 * A "candidate" is an owner-reviewed private derivative, NOT a Public Card.
 */
export type SafeDerivativeCandidate={
  key:string;accountId:string;sourceMediaId:string;safeMediaId:string
  sourceContractHash:string;safeContractHash:string;createdAt:number
}
class SafeDerivativeDb extends Dexie{
  records!:Table<SafeDerivativeCandidate,string>
  constructor(){
    super('pb3-safe-derivative-links-v1')
    this.version(1).stores({
      records:'&key,accountId,[accountId+sourceMediaId]',
    })
  }
}
const db=new SafeDerivativeDb()
const enc=new TextEncoder()
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function validateSafeDerivativeIds(
  sourceMediaId:string,safeMediaId:string,
):void{
  if(!uuid.test(sourceMediaId)||!uuid.test(safeMediaId)
    ||sourceMediaId===safeMediaId)
    throw Error('safe_media.invalid_source_or_derivative')
}
function requireActiveMedia(
  sourceMediaId:string,safeMediaId:string,local:readonly StoredMedia[],
  requireSynced:boolean,
):{source:StoredMedia;safe:StoredMedia}{
  validateSafeDerivativeIds(sourceMediaId,safeMediaId)
  const source=local.find(m=>m.mediaId===sourceMediaId)
  const safe=local.find(m=>m.mediaId===safeMediaId)
  if(!source||!safe||source.mediaType!=='photo'||safe.mediaType!=='photo'
    ||source.expiresAt<=Date.now()||safe.expiresAt<=Date.now()
    ||source.accountId!==safe.accountId
    ||requireSynced&&(source.state!=='synced'||safe.state!=='synced'))
    throw Error('safe_media.local_synced_photos_required')
  return {source,safe}
}
async function contractHash(record:StoredMedia):Promise<string>{
  return sha(enc.encode(JSON.stringify(record.contract)))
}

/**
 * Called only after explicit owner opt-in in Viewer, where masked JPEG
 * pixels have already been flattened and independently encrypted.
 * No grants are created here, even while online.
 */
export async function registerSafeDerivativeCandidate(
  sourceMediaId:string,safeMediaId:string,
):Promise<void>{
  const accountId=requireSession().accountId
  const {source,safe}=requireActiveMedia(
    sourceMediaId,safeMediaId,await listLocalMedia(),false)
  if(source.accountId!==accountId)
    throw Error('safe_media.account_changed')
  const entry:SafeDerivativeCandidate={
    key:accountId+'/'+safeMediaId,accountId,
    sourceMediaId,safeMediaId,
    sourceContractHash:await contractHash(source),
    safeContractHash:await contractHash(safe),
    createdAt:Date.now(),
  }
  if(requireSession().accountId!==accountId)
    throw Error('safe_media.account_changed')
  const existing=await db.records.get(entry.key)
  if(existing&&(existing.sourceMediaId!==sourceMediaId
    ||existing.sourceContractHash!==entry.sourceContractHash
    ||existing.safeContractHash!==entry.safeContractHash))
    throw Error('safe_media.derivative_binding_conflict')
  await db.records.put(entry)
}

export async function listSafeDerivativeCandidates():Promise<SafeDerivativeCandidate[]>{
  const account=requireSession().accountId
  const [records,local]=await Promise.all([
    db.records.where('accountId').equals(account).toArray(),listLocalMedia(),
  ])
  const ready:SafeDerivativeCandidate[]=[]
  for(const item of records){
    try{
      const {source,safe}=requireActiveMedia(
        item.sourceMediaId,item.safeMediaId,local,true)
      if(item.sourceContractHash!==await contractHash(source)
        ||item.safeContractHash!==await contractHash(safe))
        continue
      ready.push(item)
    }catch{ /* Synced-only, never fall back to a guessed source file. */ }
  }
  return ready
}

export async function requireSafeDerivativeCandidate(
  sourceMediaId:string,safeMediaId:string,
):Promise<SafeDerivativeCandidate>{
  const session=requireSession()
  const key=session.accountId+'/'+safeMediaId
  const entry=await db.records.get(key)
  if(!entry||entry.sourceMediaId!==sourceMediaId)
    throw Error('safe_media.unregistered_derivative')
  const {source,safe}=requireActiveMedia(
    sourceMediaId,safeMediaId,await listLocalMedia(),true)
  if(entry.sourceContractHash!==await contractHash(source)
    ||entry.safeContractHash!==await contractHash(safe))
    throw Error('safe_media.derivative_contract_changed')
  if(requireSession().accountId!==session.accountId)
    throw Error('safe_media.account_changed')
  return entry
}
