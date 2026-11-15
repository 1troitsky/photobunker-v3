import {shallowRef} from 'vue'

/**
 * Volatile actions for the approved Browser v3 context icons in the ONE
 * shared 64px Shell header. Registered only by the mounted catalog view.
 *
 * This bridge never carries plaintext names, file blobs, secrets, URLs,
 * browser search keywords, account identifiers or authorization grants.
 * The encrypted catalog still owns every operation and permission check.
 */
export interface BrowserShellActions {
  readonly owner:object
  readonly canCreateFolder:boolean
  readonly canSelect:boolean
  readonly selectedCount:number
  readonly createFolder:()=>void
  readonly openUpload:()=>void
  readonly toggleSelection:()=>void
  readonly focusSearch:()=>void
  readonly openSettings:()=>void
}
export const browserShellActions=shallowRef<BrowserShellActions|null>(null)

export function clearBrowserShellActions(owner:object):void {
  if(browserShellActions.value?.owner===owner)
    browserShellActions.value=null
}
