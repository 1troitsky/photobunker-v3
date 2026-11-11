import type {CatalogItem} from './catalog'
import type {ArchiveAction,ArchiveEntry,ArchiveAck} from './browser-archive'

export type ArchiveBatchTab='all'|'archive'
export type ArchiveBatchSelection={
  key:string;item:CatalogItem;target:CatalogItem|ArchiveEntry
}
export type ArchiveBatchPlan={
  action:ArchiveAction
  rows:ArchiveBatchSelection[]
}

/**
 * Scope and eligibility are selected locally; each file is still subject
 * to the signed, authenticated server ACL/TTL/CAS validation. No group-level
 * shortcut that could bypass per-file grants, assignment evidence or expiry.
 */
export function planArchiveBatch(args:{
  selectedKeys:readonly string[]
  visible:readonly CatalogItem[]
  archived:ReadonlyMap<string,ArchiveEntry>
  tab:ArchiveBatchTab;useArchive:boolean;action:ArchiveAction
}):ArchiveBatchPlan{
  const {selectedKeys,visible,archived,tab,useArchive,action}=args
  if(selectedKeys.length<1||selectedKeys.length>25
    ||new Set(selectedKeys).size!==selectedKeys.length)
    throw Error('browser.archive_batch_selection_limit')
  if(tab==='all'&&action!==(useArchive?'archive':'delete')
    ||tab==='archive'&&action==='archive')
    throw Error('browser.archive_batch_action_forbidden')
  const byKey=new Map(visible.map(row=>[row.key,row]))
  const rows:ArchiveBatchSelection[]=[]
  for(const key of selectedKeys){
    const item=byKey.get(key)
    if(!item)throw Error('browser.archive_batch_hidden_selection')
    const entry=archived.get(key)
    if(tab==='all'){
      if(!item.cloud||entry&&entry.state!=='restored')
        throw Error('browser.archive_batch_requires_cloud_owner')
      rows.push({key,item,target:entry??item})
    }else{
      if(!entry||entry.state!=='archived')
        throw Error('browser.archive_batch_requires_archived')
      rows.push({key,item,target:entry})
    }
  }
  return {action,rows}
}
export type ArchiveBatchOutcome={
  completed:string[]
  failedKey:string|null
  failure:unknown|null
}
/**
 * Sequential, bounded, fail-fast actions. A Lost ACK MUST stop the group,
 * retaining the exact signed operation in the existing AES-GCM outbox.
 * Never dispatch the next irreversible action until the previous receives
 * its authenticated server receipt.
 */
export async function executeArchiveBatch(
  plan:ArchiveBatchPlan,
  send:(target:CatalogItem|ArchiveEntry,action:ArchiveAction)=>Promise<ArchiveAck>,
  stillSameAccount:()=>boolean,
  onConfirmed:(key:string)=>void,
):Promise<ArchiveBatchOutcome>{
  const completed:string[]=[]
  for(const row of plan.rows){
    try{
      if(!stillSameAccount())
        throw Error('browser.archive_batch_session_changed')
      const result=await send(row.target,plan.action)
      if(!stillSameAccount())
        throw Error('browser.archive_batch_session_changed')
      if(result.assetId!==row.item.id
        ||result.kind!==row.item.source
        ||result.state!==(plan.action==='archive'?'archived'
          :plan.action==='restore'?'restored':'deleting'))
        throw Error('browser.archive_batch_invalid_receipt')
      completed.push(row.key)
      onConfirmed(row.key)
    }catch(e){
      return {completed,failedKey:row.key,failure:e}
    }
  }
  return {completed,failedKey:null,failure:null}
}
