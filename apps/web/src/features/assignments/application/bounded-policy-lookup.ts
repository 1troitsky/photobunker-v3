import {appendBoundedUuidPage} from './bounded-uuid-pages'

type PolicyId={assignmentId:string}
type Page<T>={items:T[];nextCursor:string|null}

/**
 * Stop at the first authenticated matching assignment without blindly
 * fetching (or decrypting metadata from) all 5,000 other policy snapshots.
 * Every page is verified by the caller and structurally checked here.
 *
 * Unlike an unbounded do/while(cursor), a server replaying the last cursor,
 * omitting rows or returning non-advancing UUIDs can never spin indefinitely.
 */
export async function findBoundedAssignmentPolicy<T extends PolicyId>(
  assignmentId:string,
  fetchVerifiedPage:(after?:string)=>Promise<Page<T>>,
):Promise<T|undefined>{
  let after:string|null=null
  for(let n=0;n<100;n++){
    const page=await fetchVerifiedPage(after??undefined)
    // Stateless per-page validation preserves early return and still
    // enforces strict cross-page monotonicity via the previous cursor.
    const checked:Page<T>=appendBoundedUuidPage<T>(
      [],page,after,(item:T)=>item.assignmentId)
    const found=checked.items.find(x=>x.assignmentId===assignmentId)
    if(found)return found
    if(checked.nextCursor===null)return undefined
    after=checked.nextCursor
  }
  throw Error('assignment.media_policy_pagination_limit')
}
