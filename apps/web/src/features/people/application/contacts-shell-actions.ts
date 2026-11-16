import {shallowRef} from 'vue'

/**
 * Owner-approved Contacts & Teams 1.1 has ONE Blacklist icon in shared Header.
 * This is local E2EE hiding ONLY, not a server grant/key/session revocation.
 */
export interface ContactsShellActions {
  readonly owner:object
  readonly open:boolean
  readonly toggle:()=>void
}
export const contactsShellActions=shallowRef<ContactsShellActions|null>(null)

export function clearContactsShellActions(owner:object):void {
  if(contactsShellActions.value?.owner===owner)contactsShellActions.value=null
}
