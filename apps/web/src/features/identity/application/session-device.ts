import type {Session} from './session'

// Online proof may replace the Session wrapper. IDs alone are insufficient:
// retain the exact key package and device envelope, as File Viewer already does.
export function sameSessionDevice(left:Session|null,right:Session|null):boolean{
  return !!left&&!!right
    &&left.accountId===right.accountId&&left.deviceId===right.deviceId
    &&left.pkg===right.pkg&&left.device===right.device
}
