import {appendBoundedUuidPage} from '../../assignments/application/bounded-uuid-pages'

export type CatalogIndexPage<T>={items:T[];nextCursor:string|null}
export type BoundedCatalogIndex<T>={
  items:T[];nextCursor:string|null;pages:number;complete:boolean
}

/**
 * An explicit opt-in can inspect only a BOUNDED number of already
 * authenticated opaque catalog index pages. No plaintext search term,
 * decrypted filename, tag or GPS is ever sent to the server.
 *
 * Refuse an invalid, duplicated, rolled-back or non-advancing UUID cursor
 * instead of treating a partial catalog as a complete search.
 */
export async function loadBoundedCatalogIndex<T>(
  fetchPage:(after?:string)=>Promise<CatalogIndexPage<T>>,
  getId:(item:T)=>string,
  stillRelevant:()=>boolean,
  maxPages=10,
):Promise<BoundedCatalogIndex<T>>{
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)
    throw Error('browser.invalid_catalog_page_limit')
  let rows:T[]=[]
  let cursor:string|null=null
  for(let i=0;i<maxPages;i++){
    if(!stillRelevant())throw Error('browser.catalog_search_cancelled')
    const page=await fetchPage(cursor??undefined)
    if(!stillRelevant())throw Error('browser.catalog_search_cancelled')
    const checked:{items:T[];nextCursor:string|null}=
      appendBoundedUuidPage(rows,page,cursor,getId)
    rows=checked.items
    if(checked.nextCursor===null)
      return {items:rows,nextCursor:null,pages:i+1,complete:true}
    cursor=checked.nextCursor
  }
  return {items:rows,nextCursor:cursor,pages:maxPages,complete:false}
}
