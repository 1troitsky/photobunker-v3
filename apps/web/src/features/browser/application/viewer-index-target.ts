import {appendAuthenticatedCatalogPage} from './authenticated-catalog-page'

type Page<T>={items:T[];nextCursor:string|null}
export type ViewerIndexResult<T>={
  items:T[];nextCursor:string|null;found:boolean
  complete:boolean;pages:number
}

/**
 * File Viewer can be opened by the authorized Browser on a file beyond the
 * first 50 server rows. Look up ONLY the target opaque ID, with strict cursor
 * invariants, at most 10 pages and no decrypted metadata or plaintext query.
 *
 * No partial new rows are published until the whole bounded search succeeds.
 * This is navigation convenience, NOT an access grant or full-account index.
 */
export async function findViewerTargetInBoundedIndex<T>(
  firstPage:Page<T>,targetId:string,
  fetchNext:(after:string)=>Promise<Page<T>>,
  getId:(item:T)=>string,
  stillCurrent:()=>boolean,
  maxPages=10,
):Promise<ViewerIndexResult<T>>{
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)
    throw Error('viewer.invalid_page_limit')
  if(!stillCurrent())throw Error('viewer.index_cancelled')
  const first=appendAuthenticatedCatalogPage([],firstPage,null,getId)
  let items=first.items
  let nextCursor=first.nextCursor
  let pages=1
  const matches=()=>items.some(row=>getId(row)===targetId)
  if(matches()||nextCursor===null)
    return {items,nextCursor,found:matches(),
      complete:nextCursor===null,pages}
  while(nextCursor!==null&&pages<maxPages){
    if(!stillCurrent())throw Error('viewer.index_cancelled')
    const response=await fetchNext(nextCursor)
    if(!stillCurrent())throw Error('viewer.index_cancelled')
    const checked:Page<T>=appendAuthenticatedCatalogPage(
      items,response,nextCursor,getId)
    items=checked.items;nextCursor=checked.nextCursor;pages++
    if(matches())break
  }
  if(!stillCurrent())throw Error('viewer.index_cancelled')
  return {items,nextCursor,found:matches(),
    complete:nextCursor===null,pages}
}
