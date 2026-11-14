/**
 * PIN Shell 1.1 background-lock timing policy.
 *
 * Product range: "Immediately" through 5 minutes. There is currently NO
 * authenticated product setting or PIN enable/change/disable flow; the
 * runtime defaults to 0 (immediate). Never read an unauthenticated timeout
 * from localStorage, URL query parameters or un-MACed device metadata.
 *
 * This controls local UI/session state only, not global erasure, device
 * revocation, operating-system memory, or in-flight external workers.
 */
export const PIN_RELOCK_MAX_MS=5*60*1000
export const PIN_RELOCK_DEFAULT_MS=0

export function validPinRelockDelayMs(value:unknown):number {
  if(typeof value!=='number' || !Number.isSafeInteger(value) ||
     value<0 || value>PIN_RELOCK_MAX_MS)
    throw new Error('pin.invalid_relock_delay')
  return value
}

/**
 * Missing, invalid or rolled-back wall-clock state cannot grant a grace
 * period. A browser that suspended timers must check the elapsed time on
 * page visibility/focus rather than trusting any previous timer firing.
 */
export function mustRelockPinAfterBackground(
  backgroundStartedAtMs:unknown,
  nowMs:unknown,
  delayMs:unknown=PIN_RELOCK_DEFAULT_MS,
):boolean {
  const delay=validPinRelockDelayMs(delayMs)
  if(!Number.isSafeInteger(backgroundStartedAtMs) ||
     !Number.isSafeInteger(nowMs) ||
     (backgroundStartedAtMs as number)<0 ||
     (nowMs as number)<(backgroundStartedAtMs as number))
    return true
  return (nowMs as number)-(backgroundStartedAtMs as number)>=delay
}
