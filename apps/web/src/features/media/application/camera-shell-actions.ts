import {shallowRef} from 'vue'

/**
 * Transient controls owned by the mounted, authenticated Camera view.
 * The common Header never stores a stream, AES-GCM keys, MediaRecorder,
 * captured image, GPS, or assignment policy.
 */
export interface CameraShellActions {
  readonly owner:object
  readonly canFlip:boolean
  readonly canTorch:boolean
  readonly torchOn:boolean
  readonly blind:boolean
  readonly canBlind:boolean
  readonly flip:()=>void
  readonly toggleTorch:()=>void
  readonly toggleBlind:()=>void
}
export const cameraShellActions=shallowRef<CameraShellActions|null>(null)
export function clearCameraShellActions(owner:object):void {
  if(cameraShellActions.value?.owner===owner)
    cameraShellActions.value=null
}
