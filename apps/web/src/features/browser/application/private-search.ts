import {activeSession,requireSession} from '../../identity/application/session'
import {readLocalPhotoMetadata,readCloudPhotoMetadata}
  from '../../photo-sync/application/p1-photo'
import {readLocalMediaMetadata,readCloudMediaMetadata}
  from '../../media/application/media-outbox'
import type {CatalogItem} from './catalog'

export type PrivateSearchRecord={
  fileName?:string;description?:string;category?:string;tags?:readonly string[]
}
export type PrivateSearchResult={
  query:string;matches:Set<string>;scanned:number;failed:number;skipped:number
  total:number
}
export function normalizePrivateSearch(value:string):string{
  return value.normalize('NFKC').toLocaleLowerCase('ru').trim()
}
/** Pure client-side matching, NEVER used as an HTTP query or indexed key. */
export function privateMetadataMatches(
  query:string,record:PrivateSearchRecord,
):boolean{
  const tokens=normalizePrivateSearch(query).split(/\s+/u).filter(Boolean)
  if(tokens.length===0)return false
  const haystack=[record.fileName,record.category,record.description,
    ...(record.tags??[])].filter((x):x is string=>typeof x==='string')
    .map(normalizePrivateSearch).join(' ')
  return tokens.every(t=>haystack.includes(t))
}
/**
 * Explicit, bounded one-page search. Fetches only metadata ciphertext,
 * verifies AEAD, and holds search terms + results in volatile JS memory.
 * No plaintext file name, description or search query enters URLs, server
 * logs, IndexedDB, localStorage or client persisted caches.
 *
 * Errors are counted rather than treating corrupted/unavailable metadata as
 * a verified nonmatch. A session upgrade invalidates the entire result.
 */
export async function searchPrivateMetadata(
  query:string,rows:readonly CatalogItem[],
  stillRelevant:()=>boolean=()=>true,
):Promise<PrivateSearchResult>{
  const session=requireSession()
  const needle=normalizePrivateSearch(query)
  if(needle.length<2||needle.length>160)throw Error('browser.search_query_limit')
  if(rows.length>200)throw Error('browser.search_page_limit')
  if(new Set(rows.map(x=>x.key)).size!==rows.length)
    throw Error('browser.search_duplicate_row')
  const matches=new Set<string>()
  let scanned=0,failed=0,skipped=0,index=0
  const live=()=>{
    if(activeSession.value!==session||!stillRelevant())
      throw Error('browser.search_session_changed')
  }
  async function worker():Promise<void>{
    while(index<rows.length){
      live()
      const item=rows[index++]!
      if(item.expiresAt<=Date.now()){skipped++;continue}
      const cloudReachable=item.cloud&&session.online
        &&(typeof navigator==='undefined'||navigator.onLine!==false)
      if(!item.local&&!cloudReachable){
        skipped++;continue
      }
      try{
        // Prefer local ciphertext; if the device cache is damaged but an
        // authenticated cloud copy exists, retry only metadata ciphertext.
        async function readLocal():Promise<PrivateSearchRecord>{
          return item.source==='photo'
            ?readLocalPhotoMetadata(item.id):readLocalMediaMetadata(item.id)
        }
        async function readCloud():Promise<PrivateSearchRecord>{
          return item.source==='photo'
            ?readCloudPhotoMetadata(item.id):readCloudMediaMetadata(item.id)
        }
        let metadata:PrivateSearchRecord
        if(item.local){
          try{metadata=await readLocal()}
          catch(e){
            live()
            if(!cloudReachable)throw e
            metadata=await readCloud()
          }
        }else metadata=await readCloud()
        live()
        scanned++
        if(privateMetadataMatches(needle,item.source==='photo'?{
          category:metadata.category,description:metadata.description,
          tags:metadata.tags,
        }:{
          fileName:metadata.fileName,category:metadata.category,
          description:metadata.description,tags:metadata.tags,
        }))matches.add(item.key)
      }catch(e){
        live()
        failed++
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,rows.length)},()=>worker()))
  live()
  return {query:needle,matches,scanned,failed,skipped,total:rows.length}
}

/**
 * Volatile, opt-in private search across at most 1,000 authenticated rows,
 * still decrypting ONLY metadata ciphertext and never building a plaintext
 * persistent index. The original per-batch 200-record safety bound remains.
 *
 * A changed session/query cancels at every batch boundary and inside the
 * existing three-worker AEAD scanner. All results are published together
 * only after every selected batch passes.
 */
export async function searchPrivateMetadataBatches(
  query:string,rows:readonly CatalogItem[],
  stillRelevant:()=>boolean=()=>true,
  onProgress?:(scanned:number,total:number)=>void,
):Promise<PrivateSearchResult>{
  const session=requireSession()
  const needle=normalizePrivateSearch(query)
  if(needle.length<2||needle.length>160)
    throw Error('browser.search_query_limit')
  if(rows.length>1000)throw Error('browser.expanded_search_limit')
  if(new Set(rows.map(item=>item.key)).size!==rows.length)
    throw Error('browser.search_duplicate_row')
  let scanned=0,failed=0,skipped=0
  const matches=new Set<string>()
  for(let offset=0;offset<rows.length;offset+=200){
    if(!stillRelevant()||activeSession.value!==session)
      throw Error('browser.search_session_changed')
    const page=await searchPrivateMetadata(needle,
      rows.slice(offset,offset+200),stillRelevant)
    for(const key of page.matches)matches.add(key)
    scanned+=page.scanned;failed+=page.failed;skipped+=page.skipped
    if(!stillRelevant()||activeSession.value!==session)
      throw Error('browser.search_session_changed')
    onProgress?.(Math.min(rows.length,offset+200),rows.length)
  }
  return {query:needle,matches,scanned,failed,skipped,total:rows.length}
}
