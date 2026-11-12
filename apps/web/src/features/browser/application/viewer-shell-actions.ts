import {shallowRef} from 'vue'

/**
 * Single Shell Header's volatile callback to the currently authenticated
 * File Viewer. The shared Shell never stores a Blob, filename, key, GPS or
 * MediaFile plaintext. The Viewer registers/unregisters on lifecycle events.
 *
 * A missing callback disables Download. Favorite, Copy and Delete are not
 * granted by this bridge; they require independent permissioned contracts.
 */
export type ViewerShellActions={
  download:()=>void
}
export const viewerShellActions=shallowRef<ViewerShellActions|null>(null)

export function setViewerShellActions(next:ViewerShellActions|null):void{
  viewerShellActions.value=next
}
