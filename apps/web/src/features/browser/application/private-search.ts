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
):Promise<PrivateSearchResult>{
  const session=requireSession()
  const needle=normalizePrivateSearch(query)
  if(needle.length<2||needle.length>160)throw Error('browser.search_query_limit')
  if(rows.length>50)throw Error('browser.search_page_limit')
  if(new Set(rows.map(x=>x.key)).size!==rows.length)
    throw Error('browser.search_duplicate_row')
  const matches=new Set<string>()
  let scanned=0,failed=0,skipped=0,index=0
  const live=()=>{if(activeSession.value!==session)
    throw Error('browser.search_session_changed')}
  async function worker():Promise<void>{
    while(index<rows.length){
      live()
      const item=rows[index++]!
      if(item.expiresAt<=Date.now()){skipped++;continue}
      if(!item.local&&(!item.cloud||!session.online
        ||typeof navigator!=='undefined'&&navigator.onLine===false)){
        skipped++;continue
      }
      try{
        const metadata=item.source==='photo'
          ?await(item.local?readLocalPhotoMetadata(item.id)
            :readCloudPhotoMetadata(item.id))
          :await(item.local?readLocalMediaMetadata(item.id)
            :readCloudMediaMetadata(item.id))
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
