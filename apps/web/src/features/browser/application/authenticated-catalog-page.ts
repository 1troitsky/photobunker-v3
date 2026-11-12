import {appendBoundedUuidPage} from '../../assignments/application/bounded-uuid-pages'

/**
 * The server's active personal-photo and MediaFile indices are authorized
 * opaque IDs, not signed private metadata. A response may still be stale,
 * truncated, duplicated or malformed. Never merge unvalidated pages into
 * the Browser's local-first catalog, and never advance a forged cursor.
 */
export function appendAuthenticatedCatalogPage<T>(
  previous:T[],
  page:{items:T[];nextCursor:string|null},
  after:string|null,
  getId:(item:T)=>string,
):{items:T[];nextCursor:string|null}{
  try{return appendBoundedUuidPage(previous,page,after,getId)}
  catch{throw Error('browser.invalid_cloud_catalog_page')}
}
