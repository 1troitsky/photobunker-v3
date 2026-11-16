import { shallowRef } from 'vue'

/**
 * Header controls are supplied by the actual mounted Notifications view.
 * No global event bus, fake ACK, stale handler or unauthorized server reads.
 */
export interface NotificationShellActions {
  readonly owner:object
  readonly canMarkAll:boolean
  readonly markAll:()=>Promise<void>
  readonly settings:()=>void
}
export const notificationShellActions=shallowRef<NotificationShellActions|null>(null)
export function clearNotificationShellActions(owner:object):void{
  if(notificationShellActions.value?.owner===owner)notificationShellActions.value=null
}
